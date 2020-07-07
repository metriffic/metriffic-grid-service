const dockerode = require('dockerode');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');
const JobType = require('./ms_job').JobType;
const Job = require('./ms_job').Job;

const LOG_JOB = require('./logging').LOG_JOB
const LOG_SESSION = require('./logging').LOG_SESSION
const LOG_TIME = require('./logging').LOG_TIME
const LOG_CONTAINER = require('./logging').LOG_CONTAINER
const ERROR = require('./logging').ERROR

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

    is_batch() 
    {
        return this.params.type === JobType.batch;
    }
    
    is_interactive() 
    {
        return this.params.type === JobType.interactive;
    }
    
    is_done()
    {
        return this.running.length == 0 && this.submitted.length == 0;
    }

    session_id() 
    {
        const sid =  this.params.name + '-' + this.params.id;
        return sid;
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
        const running_updated = [];
        this.running.forEach(rj => {
            if( rj.params.uid == job.params.uid) {
                console.log(`[S] removed completed job [${LOG_JOB(job)}], \n`,
                            `\t\tsubmitted\t${LOG_TIME(job.submit_timestamp)}, \n`,
                            `\t\tstarted  \t${LOG_TIME(job.start_timestamp)} \n`,
                            `\t\tfinished \t${LOG_TIME(job.complete_timestamp)}`);
            } else {
                running_updated.push(rj);
            }
        });
        if(running_updated.length == this.running.length) {
            console.log(ERROR(`[S] error: completed job [${LOG_JOB(job)}] can not be `,
                        `found in the list of running jobs`));
        }
        this.running = running_updated;

    }

    start() 
    {
        const params = this.params;

        console.log(`[S] starting session [${LOG_SESSION(this)}]`);

        const [folder, output_folder] = this.create_workspace();
        const input_folder = params.datasets;
        console.log(`[S] created folders: ${folder}, ${output_folder}`);

        // prepare volumes and binding for the provide-collector container...
        //const bindings = [];
        if(this.is_batch()) {
            params.datasets.forEach( ds => {
                    const jparams = {
                        uid             : shortid.generate(),
                        session_name    : params.name,
                        dataset         : ds,
                        command         : params.command,
                        complete_cb     : params.job_complete_cb,
                        out_file        : path.join(output_folder, 
                                                    'job.'+ds+'.log'),
                        docker_registry : params.docker_registry,
                        docker_image    : params.docker_image,
                        docker_options  : params.docker_options,
                        type            : JobType.batch,
                        };
                        // TBD: review the path
                        //bindings.push(`${path.resolve(ds)}:/input/${ds}`);
                        this.submit(new Job(jparams));
                    });
        } else 
        if(this.is_interactive()) {
                    const jparams = {
                        uid             : shortid.generate(),
                        session_name    : params.name,
                        user            : params.user,
                        command         : params.ssh_command,
                        complete_cb     : params.job_complete_cb,
                        out_file        : path.join(output_folder, 
                                                    'job.interactive.log'),
                        docker_registry : params.docker_registry,
                        docker_image    : params.docker_image,
                        docker_options  : params.docker_options,
                        type            : JobType.interactive,
                    };
            this.submit(new Job(jparams));         

        } else {
            console.log(ERROR(`[S] error: unknown session type: [${this.params.type}]...`));
            // TBD: make sure the session is canceled
        }
    }
    
    async stop() 
    {  
        console.log('[S] stopping the session');
        this.running.forEach(rj => {
            rj.cancel();
        });
        // this.stop_server_side_container();
    }

    create_workspace() 
    {
        const folder = path.join(this.params.user, this.params.project, this.session_id() + '.run');
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



    start_service_side_container() 
    {
         // launch the provider-collector docker
        console.log('[S] starting the server-side docker for the session...');
        const docker = new dockerode({ socketPath: '/var/run/docker.sock' });
        const session = this;
        const pc_container_name = 'pc.' + this.session_id();
        const docker_image = params.docker_registry + '/' + params.server_docker_image;

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
                return new Promise(function(resolve, reject) {
                    docker.pull(
                        docker_image,
                        function (err, stream) {
                        if (err) {
                            console.log(ERROR('[S] failed to start exec modem...'));
                            return reject();
                        }

                        let message = '';
                        if(err) return reject(err);
                        stream.on('data', data => message += data);
                        stream.on('end', () => resolve(message));
                        stream.on('error', err => reject(err));
                    });
                });
            }).then(function(msg) {
                //session.start_new_container(docker, session, params, volumes, bindings);
                    console.log(`[S] creating container for sesion ${LOG_SESSION(session)}...`);
                    return docker.createContainer({
                            Image: docker_image,
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
    stop_service_side_container() 
    {
        this.server_container.stop()
        .then(function(data) {
            console.log('[S] stopped!');
        }).catch(function(data) {
            console.log('[S] caught error when stopping...!');
        });
    }
};



module.exports.Session = Session;
