const dockerode = require('dockerode');
const fs = require('fs');
const path = require('path');
const gql = require('graphql-tag');

const { ssh_manager } = require('./ssh_manager');
const { publish_to_user_stream } = require('./data_stream');
const {
    LOG_JOB,
    LOG_BOARD,
    LOG_CONTAINER,
    LOG_IMAGE,
    ERROR 
 } = require('./logging')
const config = require('./config')
const metriffic_client = require('./metriffic_gql').metriffic_client

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
            job.params.complete_cb(job);
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
                    console.log(`[J] removing container[${LOG_CONTAINER(cntr.Id)}]....`);
                    const container = board.docker.getContainer(cntr.Id);
                    return container.remove({ 
                        force: true,  // force removal
                        v: true       // remove associated volumes as well
                    }).then(function(data){
                        console.log('[J] done.');
                    }).catch(function(err){
                        //console.log(`[J] remove container error [${LOG_BOARD(board)}], ${err}`);
                    }).finally(function(data){
                        console.log(`[J] container cleanup done for board[${LOG_BOARD(board)}].`);
                    });
                    //return container.stop()
                    //.then(function(data){
                    //    console.log('[J] done.');
                    //}).catch(function(data) {
                    //    console.log(ERROR('[J] failed to stop the container, removing...'));
                    //    container.remove().catch(function(){
                    //        console.log(ERROR('[J] failed to remove the container as well, giving up!'));
                    //    });
                    //}).finally(function(data){
                    //    console.log(`[J] container cleanup done for board[${LOG_BOARD(board)}].`);
                    //});
                });

        await Promise.all(promises);
    }

    async docker_image_pull() 
    {
        const job = this;
        const board = this.board;

        const pull = new Promise(function(resolve, reject) {
            const auth = {
                username: config.DOCKER_REGISTRY_USERNAME,
                password: config.DOCKER_REGISTRY_PASSWORD,
                serveraddress: config.DOCKER_REGISTRY_HOST,
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
                    stream.on('data', data => { 
                        //console.log('PULL', JSON.parse(data.toString('utf8')))
                        // send pull updates only for interactive runs...
                        if(job.params.type == JobType.interactive) {
                            publish_to_user_stream(job.params.username, {type: 'pull_data', data: data.toString('utf8')});
                        }
                    });
                    stream.on('end', () => { 
                        if(job.params.type == JobType.interactive) {
                            publish_to_user_stream(job.params.username, {type: 'pull_success'});
                        }
                        resolve(); 
                    });
                    stream.on('error', err => { 
                        console.log(ERROR(`[J] failed to push the image ${err}`)); 
                        if(job.params.type == JobType.interactive) {
                            publish_to_user_stream(job.params.username, {type: 'pull_error', error: err});
                        }
                        reject(err); 
                    });
                });
        }); 
        await pull;
    }

    async docker_image_push(docker_repo)
    {
        console.log(`[J] pushing image ${LOG_IMAGE(docker_repo)}`);
        const job = this;
        const docker = job.board.docker;
        const image = await docker.getImage(docker_repo);

        const push = new Promise(function(resolve, reject) {
            const auth = {
                username: config.DOCKER_REGISTRY_USERNAME,
                password: config.DOCKER_REGISTRY_PASSWORD,
                serveraddress: config.DOCKER_REGISTRY_HOST,
            };
            image.push(
                {'authconfig': auth},
                function (err, stream) {
                    if (err) {
                        console.log(ERROR(`[J] failed to start exec modem: ${err}`));
                        return reject();
                    }
                    stream.on('data', data => { 
                        publish_to_user_stream(job.params.username, {type: 'push_data', data: data.toString('utf8')});
                    });
                    stream.on('end', () => { 
                        publish_to_user_stream(job.params.username, {type: 'push_success'});
                        resolve(); 
                    });
                    stream.on('error', err => { 
                        console.log(ERROR(`[J] failed to push the image ${err}`)); 
                        publish_to_user_stream(job.params.username, {
                            type: 'push_error',
                            error: err,
                        });            
                        reject(err); 
                    });
                });
        }); 
        await push;        
    }


    async docker_volume_create()
    {
        const nfs_host = config.NFS_HOST;

        const username = this.params.username;
        const userspace = this.params.userspace;
        await this.board.docker.createVolume({
            Name: 'workspace.' + username, 
            Driver: 'local', 
            DriverOpts: {
                'type': 'nfs',
                'device': ':' + userspace,
                'o': 'addr=' + nfs_host + ',rw',
            }
        }, (err, volume) => {
            if(err) {
                console.trace(err);
                return;
            }
        })    

        const publicspace = this.params.publicspace;
        await this.board.docker.createVolume({
            Name: 'publicspace', 
            Driver: 'local', 
            DriverOpts: {
                'type': 'nfs',
                'device': ':' + publicspace,
                'o': 'addr=' + nfs_host + ',ro',
            }
        }, (err, volume) => {
            if(err) {
                console.trace(err);
                return;
            }
        })    
    }

    async docker_container_commit(docker_repo)
    {
        const job = this;
        console.log(`[J] committing image for container from job[${LOG_JOB(job)}] as ${LOG_IMAGE(docker_repo)}`);
        await job.container.commit({
                    repo: docker_repo,
                });            
    }

    async docker_container_run()
    {
        const job = this;
        const board = job.board;
        const job_id = this.params.uid;
        const session_name = this.params.session_name;
        const userspace =  'workspace.' + this.params.username;
        const publicspace = 'publicspace';
        var exposed_ports = {};
        const host_config = this.params.docker_options && this.params.docker_options.HostConfig ? 
                                this.params.docker_options.HostConfig : {};

        host_config.Binds = [
            userspace + ':/workspace', 
            publicspace + ':/public',
        ];
        host_config.AutoRemove = true;
        // if this is an interactive session, prepare ssh-manager and set up docker port forwarding
        if(job.is_interactive()) {
            await ssh_manager.setup_session(job);
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
                                            Volumes:{
                                                '/workspace': {},
                                                '/public': {}
                                            },
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
            publish_to_user_stream(job.params.username, {
                                    type: 'exec_error',
                                    error: err,
                                });
        } else 
        if (!data.Running) {
            console.log(`[J] docker execution for job[${LOG_JOB(job)}] exited with code ${data.ExitCode}`);
                    // if this is an interactive session: set up update the data and publish it to the user...
            if(job.is_interactive() && job.ssh_user) {
                const ssh_user = job.ssh_user;
                //ssh_user.container = job.container.id.slice(0,12);
                ssh_manager.start_session(job);
                publish_to_user_stream(job.params.username, {
                                        type: 'exec_success',
                                        data: {
                                            port: ssh_user.docker_port,
                                            host: ssh_user.docker_host,
                                            username: ssh_user.username,
                                            password: ssh_user.password
                                        },
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

        if(job.exclusive) {
            await job.docker_containers_cleanup();
        }

        console.log(`[J] container cleanup for board[${LOG_BOARD(board)}] is done, pulling the requested image [${this.docker_image()}]`);
        try {
            await job.docker_image_pull();
        } catch(err) {
            console.log(ERROR(`[J] error: failed to pull image [${this.docker_image()}] on board[${LOG_BOARD(board)}]...`));
            job.cancel();
            publish_to_user_stream(job.params.username, {
                type: 'start_error',
                error: err,
            });
            return;
        }

        console.log(`[J] image ready for [${LOG_BOARD(board)}], creating nfs mount...`);
        try {
            await job.docker_volume_create();
        } catch(err) {
            console.log(ERROR(`[J] error: failed to mount the nfs userspace for job[${LOG_JOB(job)}], ${err}`));
            job.cancel();
            publish_to_user_stream(job.params.username, {
                type: 'start_error',
                error: err,
            });
            return;
        };

        console.log(`[J] userspace is successfully mount for [${LOG_BOARD(board)}], running...`);
        try {
            await job.docker_container_run();
        } catch(err) {
            console.log(ERROR(`[J] error: failed to start the container for job[${LOG_JOB(job)}], ${err}`));
            job.cancel();
            publish_to_user_stream(job.params.username, {
                type: 'start_error',
                error: err,
            });
            return;
        };

        // TBD: handle the case when job.container is null!

        console.log(`[J] container[${LOG_CONTAINER(job.container.id)}] is created for job[${LOG_JOB(job)}].`);
        try {
            await job.docker_container_exec();
        } catch(err) {
            console.log(ERROR(`[J] error: failed to exec the container for job[${LOG_JOB(job)}] on board[${LOG_BOARD(board)}], error: ${err}...`));
            job.cancel();
            publish_to_user_stream(job.params.username, {
                type: 'start_error',
                error: err,
            });
            return;
        }

        if(job.is_batch()) {
            await job.complete();
        }
    }

    async complete() {
        this.state = JobState.completed;
        this.stop_container();
    }

    async cancel() {
        this.state = JobState.canceled;
        this.stop_container();
    }

    async save(docker_image_name, docker_image_description) {
        const job = this;
        const docker_repo = job.params.docker_registry + '/' + docker_image_name;
        try {
            await job.docker_container_commit(docker_repo);
        } catch(err) {
            console.log(ERROR(`[J] error: failed to commit from container [${LOG_CONTAINER(job.container.id)}] as [${LOG_IMAGE(docker_image_name)}], ${err}`,));
            publish_to_user_stream(job.params.username, {
                type: 'commit_error',
                error: err,
            });
            return;
        }
                
        try {
            await job.docker_image_push(docker_repo);
            await job.register_new_docker_image(job.params.platform_id, docker_image_name,
                                                job.params.docker_options, docker_image_description);
        } 
        catch(err) {
            console.log(ERROR(`[J] error: failed to save image [${LOG_IMAGE(docker_image_name)}]: ${err}...`));
            publish_to_user_stream(job.params.username, {
                type: 'commit_error',
                error: err,
            });
            return;
        }
    }

    async register_new_docker_image(docker_platform_id, docker_image,
                                    docker_options, docker_descritions)
    {
        docker_descritions = "blabla";
        const job = this;
        const docker_image_create = gql`
        mutation dockerImageCreate ($platformId: Int!, $name: String!, 
                                    $options: String, $description: String) { 
            dockerImageCreate(platformId: $platformId, name: $name, 
                              options: $options, description: $description) 
            { id }
        }`;
            
        metriffic_client.gql.mutate({
            mutation: docker_image_create,
            variables: { platformId: docker_platform_id, 
                         name: docker_image,
                         options: JSON.stringify(docker_options),
                         description: docker_descritions }
        }).then(function(ret) {
            console.log(`[J] registered new docker image: ${ret}`);
            publish_to_user_stream(job.params.username, {
                type: 'register_success'
            });
        }).catch(function(err){
            console.log(ERROR(`[J] error: failed to register new docker image: ${err}`));
            publish_to_user_stream(job.params.username, {
                type: 'register_error',
                error: err,
            });
        });
    }
};

module.exports.JobType = JobType;
module.exports.JobState = JobState;
module.exports.Job = Job;
