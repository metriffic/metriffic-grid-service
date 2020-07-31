const dockerode = require('dockerode');
const fs = require('fs');
const path = require('path');

const { ssh_manager } = require('./ssh_manager');
const { publish_to_user_stream } = require('./data_stream');

const LOG_JOB = require('./logging').LOG_JOB
const LOG_BOARD = require('./logging').LOG_BOARD
const LOG_CONTAINER = require('./logging').LOG_CONTAINER
const ERROR = require('./logging').ERROR
const config = require('./config')

const JobType = {
    batch:       'BATCH',
    interactive: 'INTERACTIVE'
}

const JobState = {
    submitted: 'SUBMITTED',
    running:   'RUNNING',
    completed: 'COMPLETED',
    canceled:  'CANCELED'
}


class Job 
{
    constructor(params) 
    {
        this.params = params;
        this.submit_timestamp = 0;
        this.start_timestamp = 0;
        this.complete_timestamp = 0;
        this.container = null;
        this.board = null;
        this.state = JobState.submitted;
    }


    is_batch() 
    {
        return this.params.type === JobType.batch;
    }
    
    is_interactive() 
    {
        return this.params.type === JobType.interactive;
    }

    stop_container()
    {
        const job = this;
        // release the ssh port if one was reserved for the job
        if(job.user && job.user.port) {
            ssh_manager.release_port(job);
        }
        // stop the container...
        if(job.container) {
            console.log(`[J] stopping container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(job.board)}]`);
            return job.container.stop()
                    .then(function(data) {
                        console.log(`[J] job[${LOG_JOB(job)}] is complete...`);
                    }).catch(function(err){
                        if(err.statusCode == 304) { // already stopped: ok
                            console.log(ERROR(`[J] the container for job[${LOG_JOB(job)}] is already stopped...`));
                        } else {
                            console.log(ERROR(`[J] failed to stop the container for job[${LOG_JOB(job)}], error: ${err}`));
                        }
                    }).finally(function(){
                        // check if the board exists and stop it (need the check in case it's already stopped)
                        if(job.board) {
                            job.board.release();
                            job.board = null;
                            job.params.complete_cb(job);
                        }
                    });
        } else {
            job.board.release();
            job.board = null;
        }
    }

    cleanup()
    {
    }

    docker_image()
    {
        return this.params.docker_registry + '/' + this.params.docker_image;
    }

    async docker_containers_cleanup()
    {
        const board = this.board;

        const list_containers = board.docker.listContainers({
                                                    all: true
                                                });
        const containers = await list_containers;

        const promises = containers.map(function(cntr) {
                    console.log(`[J] stopping container[${LOG_CONTAINER(cntr.Id)}]....`);
                    const container = board.docker.getContainer(cntr.Id);
                    return container.stop()
                    .then(function(data){
                        console.log('[J] done.');
                    }).catch(function(data) {
                        console.log(ERROR('[J] failed to stop the container, removing...'));
                        container.remove().catch(function(){
                            console.log(ERROR('[J] failed to remove the container as well, giving up!'));
                        });
                    }).finally(function(data){
                        console.log(`[J] container cleanup done for board[${LOG_BOARD(board)}].`);
                    });
                });

        await Promise.all(promises);
    }

    async docker_image_pull() 
    {
        const job = this;
        const board = this.board;

        const pull = new Promise(function(resolve, reject) {
            const auth = {
                username: 'admin',
                password: 'admin',
                serveraddress: 'https://docker.metriffic.com'
            };
            //const auth = { key: 'yJ1J2ZXJhZGRyZXNzIjoitZSI6Im4OCIsImF1dGgiOiIiLCJlbWFpbCI6ImZvbGllLmFkcmc2VybmF0iLCJzZX5jb2aHR0cHM6Ly9pbmRleC5kb2NrZXIuaW8vdZvbGllYSIsInBhc3N3b3JkIjoiRGVjZW1icmUjEvIn0=' }
            board.docker.pull(
                job.docker_image(),
                {'authconfig': auth},
                function (err, stream) {
                if (err) {
                    console.log(ERROR(`[J] failed to start exec modem: ${err}`));
                    return reject();
                }
                let message = '';
                stream.on('data', data => { message += data });
                stream.on('end', () => resolve(message));
                stream.on('error', err => reject(err));
            });
        }); 
        await pull;
    }

    async docker_volume_create()
    {
        const username = this.params.user;
        await this.board.docker.createVolume({
            Name: 'workspace.' + username, 
            Driver: 'local', 
            DriverOpts: {
                'type': 'nfs',
                'device': ':' + path.join(config.USERSPACE_DIR_ROOT, username),
                'o': 'addr=' + config.USERSPACE_HOST + ',rw',
            }
        }, (err, volume) => {
            if(err) {
                console.trace(err);
                return;
            }
        })    
    }

    async docker_container_run()
    {
        const job = this;
        const board = job.board;
        const job_id = this.params.uid;
        const session_name = this.params.session_name;
        const workspace =  'workspace.' + this.params.user;
        var exposed_ports = {};
        const host_config = this.params.docker_options && this.params.docker_options.HostConfig ? 
                                this.params.docker_options.HostConfig : {};

        host_config.Binds = [workspace + ':/workspace'];
        host_config.AutoRemove = true;
        // if this is an interactive session, prepare ssh-manager and set up docker port forwarding
        if(job.is_interactive()) {
            ssh_manager.setup_session(job);
            job.params.command = ["/bin/bash", "-c", `echo -e \"${job.ssh_user.password}\\n${job.ssh_user.password}\" | passwd root; service ssh start`],

            exposed_ports = { "22/tcp": {}};
            host_config.PortBindings = { '22/tcp': [{'HostPort': job.ssh_user.docker_port.toString(), 
                                                    'HostIp': job.ssh_user.docker_host}]};
        }
        const container = await board.docker.createContainer({
                                            Image: job.docker_image(),
                                            name: `session-${session_name}.job-${job_id}`,
                                            Cmd: ['/bin/bash'],
                                            Tty: true,
                                            Volumes:{'/workspace': {}},
                                            ExposedPorts: exposed_ports,
                                            HostConfig: host_config,
                                        });

        console.log(`[J] starting container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}].`);
        job.container = container;
        await job.container.start();
    }

    docker_exec_stream_handler(err, data) 
    {
        const job = this;
        if (err) {
            console.log(`[J] docker execution for job[${LOG_JOB(job)}] exited with code ${data.ExitCode}, error: ${err}`);
        } else 
        if (!data.Running) {
            console.log(`[J] docker execution for job[${LOG_JOB(job)}] exited with code ${data.ExitCode}`);
                    // if this is an interactive session: set up update the data and publish it to the user...
            if(job.is_interactive() && job.ssh_user) {
                const ssh_user = job.ssh_user;
                //ssh_user.container = job.container.id.slice(0,12);
                ssh_manager.start_session(job);
                publish_to_user_stream(job.params.user, {
                                        port: ssh_user.docker_port,
                                        host: ssh_user.docker_host,
                                        username: ssh_user.username,
                                        password: ssh_user.password
                                    });
            }
        }   
    }

    async docker_container_exec()
    {
        const job = this;
        console.log(`[J] executing command [${job.params.command}]`);
        const exec = await job.container.exec({
                                    Cmd: job.params.command,
                                    AttachStdout: true,
                                    AttachStderr: true,
                                    Tty: true
                                 });

        const stream_start =  new Promise(function(exec_resolve, exec_reject) {
            exec.start((err, stream) => {
                if (err) {
                    console.log(ERROR('[J] failed to start exec modem...'));
                    return reject();
                }
                const out_stream = fs.createWriteStream(job.params.out_file);
                job.container.modem.demuxStream(stream, out_stream, out_stream);
                new Promise(function(resolve, reject) {

                    let message = '';
                    stream.on('data', data => {  message += data});
                    stream.on('end', function () { 
                        console.log(`[J] stream from job[${LOG_JOB(job)}] ended.`);
                        exec.inspect((err, data) => job.docker_exec_stream_handler(err, data));
                        resolve(); 
                    });
                }).finally(function(data) {
                    exec_resolve();
                });
            });
        });

        try {
            await stream_start;
        } catch(e) {
            console.log(ERROR('stream exec error: ', err));
        };
    }

    async start(board) 
    {
        const job = this;
        job.board = board;
        job.start_timestamp = Date.now();
        job.state = JobState.running;

        await job.docker_containers_cleanup();
        
        console.log(`[J] container cleanup for board[${LOG_BOARD(board)}] is done, pulling the requested image [${this.docker_image()}]`);
        try {
            await job.docker_image_pull();
        } catch(e) {
            console.log(ERROR(`[J] failed to pull image [${this.docker_image()}] on board[${LOG_BOARD(board)}]...`));
            return;
        }

        console.log(`[J] image ready for [${LOG_BOARD(board)}], creating nfs mount...`);
        try {
            await job.docker_volume_create();
        } catch(e) {
            console.log(ERROR(`[J] Failed to mount the nfs userspace for job[${LOG_JOB(job)}], ${e}`));
        };

        console.log(`[J] userspace is successfully mount for [${LOG_BOARD(board)}], running...`);
        try {
            await job.docker_container_run();
        } catch(e) {
            console.log(ERROR(`[J] Failed to start the container for job[${LOG_JOB(job)}], ${e}`));
        };

        // TBD: handle the case when job.container is null!

        console.log(`[J] container[${LOG_CONTAINER(job.container.id)}] is created for job[${LOG_JOB(job)}].`);
        try {
            await job.docker_container_exec();
        } catch(e) {
            console.log(ERROR(`[J] failed to exec the container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}], error: ${e}...`));
        }

        if(job.is_batch()) {
            await job.complete();
        }
    }

    complete() {
        this.state = JobState.completed;
        this.stop_container();
    }
    cancel() {
        this.state = JobState.canceled;
        this.stop_container();
    }
};

module.exports.JobType = JobType;
module.exports.JobState = JobState;
module.exports.Job = Job;
