const { ShellServer, Authenticators } = require('ssh2-shell-server');
const { Client } = require('ssh2');
const fs = require('fs');
const crypto = require('crypto');
const password_generator = require('generate-password');
const inspect = require('util').inspect;
const detect = require('detect-port');

const LOG_JOB = require('./logging').LOG_JOB
const ERROR = require('./logging').ERROR;
const config = require('./config');
const { resolve } = require('path');
const { rejects } = require('assert');

class SSHManager 
{
    constructor() 
    {
        this.start = config.SSH_PORT_HOST_MIN;        
        //this.registered_users = new Map();
    }

    setup_session(job)
    {
        return detect(this.start)
            .then(available_port => {
                console.log(`[SSHM] reserving port ${available_port} for job[${LOG_JOB(job)}]`)       
                //const username = job.params.user; 
                job.ssh_user = {
                    docker_port: available_port,
                    docker_host: job.board.hostname,
                    username: 'root',
                    //port: new_port,
                    password: password_generator.generate({
                                                    length: 16,
                                                    numbers: true
                                                })
                };
            }).catch(err => {
                console.log(ERROR(`[SSHM] error reserving port: ${err}`));
            });
    }

    start_session(job)
    {   
    }

    end_session(job) 
    {
        if(job.port == null) {
            return;
        }
        if(job.ssh_user.port) {
            console.log(`[SSHM] releasing port ${port} for job[${LOG_JOB(job)}]`);
        }
        //this.registered_users.delete(job.user.user);
    }
};

module.exports.ssh_manager = new SSHManager();

