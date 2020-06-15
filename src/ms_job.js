const dockerode = require('dockerode');
const fs = require('fs');

const LOG_JOB = require('./ms_logging').LOG_JOB
const LOG_BOARD = require('./ms_logging').LOG_BOARD
const LOG_CONTAINER = require('./ms_logging').LOG_CONTAINER
const ERROR = require('./ms_logging').ERROR

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

    stop_container()
    {
        const job = this;
        if(job.container) {
            console.log(`[J] stopping container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(job.board)}]`);
            return job.container.stop()
                    .then(function(data) {
                        console.log(`[J] job[${LOG_JOB(job)}] is complete...`);
                    }).catch(function(data){
                        console.log(ERROR(`[J] failed to stop the container for job[${LOG_JOB(job)}]...`));
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

    start(board) 
    {
        const job = this;
        job.board = board;
        job.start_timestamp = Date.now();

        //console.log(`[J] starting job [${LOG_JOB(job)}]`);
        const docker_image = this.params.docker_registry + '/' + this.params.docker_image;
        board.docker.listContainers({
            all: true
        }).then(function(containers) {
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

            return Promise.all(promises);
        }).then(function() {
            return new Promise(function(resolve, reject) {
                board.docker.pull(
                    docker_image,
                    function (err, stream) {
                    if (err) {
                        console.log(ERROR('[J] failed to start exec modem...'));
                        return reject();
                    }

                    let message = '';
                    if(err) return reject(err);
                    stream.on('data', data => message += data);
                    stream.on('end', () => resolve(message));
                    stream.on('error', err => reject(err));
                });
            });        
        }).then(function(data){
            console.log(`[J] container cleanup for board[${LOG_BOARD(board)}] is done.`);
            return board.docker.createContainer({
                Image: docker_image,
                name: 'brd.bladabla',
                Cmd: ['/bin/bash'],
                Tty: true,
                HostConfig: {
                    AutoRemove: true
                }});
        }).then(function(container) {
            console.log(`[J] starting container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}].`);
            job.container = container;
            return job.container.start();
        }).then(function(data) {
            console.log(`[J] container[${LOG_CONTAINER(job.container.id)}] is created for job[${LOG_JOB(job)}].`);
            return job.container.exec({
                    Cmd: job.params.command,
                    AttachStdout: true,
                    AttachStderr: true,
                    Tty: true
            });
        }).then(function(exec) {
            return new Promise(function(exec_resolve, exec_reject) {
                exec.start((err, stream) => {
                    if (err) {
                        console.log(ERROR('[J] failed to start exec modem...'));
                        return reject();
                    }
                    const out_stream = fs.createWriteStream(job.params.out_file);
                    job.container.modem.demuxStream(stream, out_stream, out_stream);
                    new Promise(function(resolve, reject) {
                        stream.on('end', function () { 
                            console.log(`[J] stream from job[${LOG_JOB(job)}] ended.`);
                            exec.inspect(function(err, data) {
                                if (!err && !data.Running) {
                                    console.log(`[J] job[${LOG_JOB(job)}] exited with code ${data.ExitCode}`);
                                }
                            });
                            resolve(); 
                        });
                    }).finally(function(data) {
                        exec_resolve();
                    });
                });
            });

        }).catch(function(err) {
            console.log(ERROR(`[J] failed to exec the container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}]...`));
            // TBD: possible error: err { Error: (HTTP code 400) unexpected - No exec command specified 
            console.log('err', err);
        }).finally(function() {
            job.stop_container();
        });
    }
};

module.exports.Job = Job;
