const dockerode = require('dockerode');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');
const Job = require('./ms_job').Job;

const LOG_JOB = require('./ms_logging').LOG_JOB
const LOG_SESSION = require('./ms_logging').LOG_SESSION
const LOG_TIME = require('./ms_logging').LOG_TIME
const LOG_CONTAINER = require('./ms_logging').LOG_CONTAINER
const ERROR = require('./ms_logging').ERROR

class Session
{
    constructor(params) 
    {
        this.params = params;
        this.submitted = [];
        this.running = [];
        console.log('[S] initialized session with following params:\n',
                    `${JSON.stringify(this.params, undefined, 2)}`);
    }

    accept_next() 
    {
        if(this.submitted.length && this.running.length < this.params.max_jobs) {
            const job = this.submitted.shift();
            this.running.push(job);
            //console.log(`[S] accepting job[${LOG_JOB(job)}] from session [${LOG_SESSION(this)}], ` +
            //            `total jobs: ${this.submitted.length} submitted, ` + 
            //            `${this.running.length} running.`);
            return job;
        }
        return null;
    }

    on_complete(job) 
    {
        const update_running = [];
        this.running.forEach(rj => {
            if( rj.params.uid == job.params.uid) {
                console.log(`[S] removed completed job [${LOG_JOB(job)}], \n`,
                            `\t\tsubmitted\t${LOG_TIME(job.submit_timestamp)}, \n`,
                            `\t\tstarted  \t${LOG_TIME(job.start_timestamp)} \n`,
                            `\t\tfinished \t${LOG_TIME(job.complete_timestamp)}`);
            } else {
                update_running.push(rj);
            }
        });
        if(update_running.length == this.running.length) {
            console.log(ERROR(`[S] error: completed job [${LOG_JOB(job)}] can not be `,
                        `found in the list of running jobs`));
        }
        this.running = update_running;

    }

    is_done()
    {
        return this.running.length == 0 && this.submitted.length == 0;
    }

    start_new_container(docker, session, params, volumes, bindings)
    {
        console.log(`[S] CCC`);
        const pc_container_name = 'pc.'+params.name;
        docker.createContainer({
                Image: params.docker_registry + '/' + params.server_docker,
                Volumes: volumes,
                HostConfig: { 
                    Binds: bindings,
                    AutoRemove: true
                },
                name: pc_container_name,
                Tty: true,
                Cmd: ['/bin/bash'],
        }).then(function(container) {
            session.server_container = container;
            console.log(`[S] starting server container [${LOG_CONTAINER(session.server_container.id)}]`);
            return session.server_container.start();
        }).then(function(data) {
            console.log('[S] server container started');
        });
    }

    start() 
    {
        const params = this.params;

        console.log(`[S] starting session [${LOG_SESSION(this)}]`);

        const [folder, output_folder] = this.create_workspace(params.user, 
                                                              params.project, 
                                                              params.name);
        const input_folder = params.datasets;
        console.log(`[S] created folders: ${folder}, ${output_folder}`);

        // prepare volumes and binding for the provide-collector container...
        const bindings = [];
        params.datasets.forEach( ds => {
                            const jparams = {
                                command         : params.command,
                                complete_cb     : params.job_complete_cb,
                                out_file        : path.join(output_folder, 
                                                            'job.'+ds+'.log'),
                                docker_registry : params.docker_registry,
                                server_docker   : params.server_docker,
                             };
                             jparams.dataset = ds;
                             jparams.uid = shortid.generate();
                             // TBD: review the path
                             bindings.push(`${path.resolve(ds)}:/input/${ds}`);
                             this.submit(new Job(jparams));
                         });
        bindings.push(`${path.resolve(output_folder)}:/output`);
        const volumes = { '/output': {} };
        params.datasets.forEach(ds => { volumes[`/input/${ds}`] = {}; });

        // launch the provider-collector docker
        console.log('[S] starting the server-side docker for the session...');
        const docker = new dockerode({ socketPath: '/var/run/docker.sock' });
        const session = this;
        const pc_container_name = 'pc.'+params.name;

        return new Promise(function(resolve, reject){ 
            docker.listContainers({
                name: [pc_container_name]
            }).then(function(containers) {
                const promises = containers.map(async function(cntr) {
                        console.log(`[S] stopping container [${LOG_CONTAINER(cntr.Id)}]....`);
                        const container = docker.getContainer(cntr.Id);
                        return container.stop()
                        .then(function(data){
                            console.log('[S] done.');
                        }).catch(function(data) {
                            console.log(ERROR('[S] failed to stop the container, removing...'));
                            container.remove();
                        }).finally(function(data){
                            console.log(`[S] container cleanup done for sesion ${LOG_SESSION(session)}...`);
                        });
                    });

                return Promise.all(promises);
            }).then(function() {
                    //session.start_new_container(docker, session, params, volumes, bindings);
                    console.log(`[S] creating container for sesion ${LOG_SESSION(session)}...`);
                    return docker.createContainer({
                            Image: params.docker_registry + '/' + params.server_docker,
                            Volumes: volumes,
                            HostConfig: { 
                                Binds: bindings,
                                AutoRemove: true
                            },
                            name: pc_container_name,
                            Tty: true,
                            Cmd: ['/bin/bash'],
                    });
            }).then(function(container) {
                session.server_container = container;
                console.log(`[S] starting server container [${LOG_CONTAINER(session.server_container.id)}]`);
                return session.server_container.start();
            }).then(function(data) {
                console.log('[S] server container started');
                resolve();
            });
                    
        });
    }
    
    async stop() 
    {  
        console.log('[S] stopping the session');
        //TBD: this.server container can be undefined...
        this.server_container.stop()
        .then(function(data) {
            console.log('[S] stopped!');
        }).catch(function(data) {
            console.log('[S] caught error when stopping...!');
        });
    }

    create_workspace(user, project, session_name) 
    {
        const folder = path.join(user, project, session_name + '.run');
        const output_folder = path.join(folder, 'output');
        fs.mkdirSync(folder, { recursive: true });
        fs.mkdirSync(output_folder, { recursive: true });
        return [folder, output_folder];
    }

    submit(job) 
    {
        job.session = this;
        job.submit_timestamp = Date.now();
        this.submitted.push(job);
        console.log(`[S] submitting job [${LOG_JOB(job)}] to session[${LOG_SESSION(this)}], `+ 
                    `total submitted: ${this.submitted.length} jobs`);
    }

};


module.exports.Session = Session;
