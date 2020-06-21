const dockerode = require('dockerode');
const fs = require('fs');

const ssh_manager = require('./ssh_manager').ssh_manager;

const LOG_JOB = require('./logging').LOG_JOB
const LOG_BOARD = require('./logging').LOG_BOARD
const LOG_CONTAINER = require('./logging').LOG_CONTAINER
const ERROR = require('./logging').ERROR

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
    }


    is_batch() 
    {
        return this.params.type === 'batch';
    }
    
    is_interactive() 
    {
        return this.params.type === 'interactive';
    }

    stop_container()
    {
        const job = this;
        // release the ssh port if one was reserved for the job
        if(job.ssh_port) {
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
                            console.log(ERROR(`[J] failed to stop the container for job[${LOG_JOB(job)}]... `));
                            console.log(err)
                        }
                    }).finally(function(data){
                        job.board.release();
                        job.board = null;
                        job.params.complete_cb(job);
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
            board.docker.pull(
                job.docker_image(),
                function (err, stream) {
                if (err) {
                    console.log(ERROR(`[J] failed to start exec modem: ${err}`));
                    return reject();
                }
                let message = '';
                if(err) return reject(err);
                stream.on('data', data => { message += data });
                stream.on('end', () => resolve(message));
                stream.on('error', err => reject(err));
            });
        }); 
        await pull;
    }

    async docker_container_run()
    {
        const job = this;
        const board = job.board;
        const job_id = this.params.uid;
        const session_name = this.params.session_name;
        var exposed_ports = {};
        var port_bindings = {};
        job.ssh_port = ssh_manager.reserve_port(job);
        if(job.is_interactive) {
            exposed_ports = { "22/tcp": {}};
            port_bindings = { '22/tcp': [{'HostPort': job.ssh_port.toString(), 
                                          'HostIp':'0.0.0.0'}]};
        }
        const container = await board.docker.createContainer({
                                            Image: job.docker_image(),
                                            name: `session-${session_name}.job-${job_id}`,
                                            Cmd: ['/bin/bash'],
                                            Tty: true,
                                            ExposedPorts: exposed_ports,
                                            HostConfig: {
                                                PortBindings: port_bindings,
                                                AutoRemove: true
                                            }
                                        });

        console.log(`[J] starting container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}].`);
        job.container = container;
        await job.container.start();
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
                        exec.inspect(function(err, data) {
                            if (!err && !data.Running) {
                                console.log(`[J] job[${LOG_JOB(job)}] exited with code ${data.ExitCode}`);
                                //console.log('MSG',message);
                                //reject();
                            }
                        });
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

        await job.docker_containers_cleanup();
        
        console.log(`[J] container cleanup for board[${LOG_BOARD(board)}] is done, pulling the requested image [${this.docker_image()}]`);
        try {
            await job.docker_image_pull();
        } catch(e) {
            console.log(ERROR(`[J] failed to pull image [${this.docker_image()}] on board[${LOG_BOARD(board)}]...`));
            return;
        }

        console.log(`[J] image ready for [${LOG_BOARD(board)}], running...`);
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
            console.log(ERROR(`[J] failed to exec the container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}]...`));
        }

        if(job.is_batch()) {
            await job.complete();
        }
    }

    complete() {
        this.state = "COMPLETED";
        this.stop_container();
    }
    cancel() {
        this.state = "CANCELED";
        this.stop_container();
    }
};

module.exports.Job = Job;
