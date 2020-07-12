const { ShellServer, Authenticators } = require('ssh2-shell-server');
const { Client } = require('ssh2');
const fs = require("fs");
const crypto = require("crypto");
const password_generator = require('generate-password');
const inspect = require("util").inspect;

const LOG_JOB = require('./logging').LOG_JOB
const ERROR = require('./logging').ERROR;
const config = require('./config')

class SSHManager 
{
    constructor() 
    {
        this.ports = [];
        this.ports.length = config.SSH_PORT_HOST_MAX - config.SSH_PORT_HOST_MIN;
        this.ports.fill(false);
        this.start = config.SSH_PORT_HOST_MIN;        
        this.reserve_count = 0;
        //this.registered_users = new Map();
    }

    setup_session(job)
    {
        for(let i = 0; i < this.ports.length; ++i) {
            if(this.ports[i]  == false) { 
                this.ports[i] = true;                
                this.reserve_count++;
                const new_port = this.start + i;
                console.log(`[SSHM] reserving port ${new_port} for job[${LOG_JOB(job)}]`)       
                //const username = job.params.user; 
                job.ssh_user = {
                    docker_port: new_port,
                    docker_host: job.board.hostname,
                    username: 'root',
                    //port: new_port,
                    password: password_generator.generate({
                                                    length: 16,
                                                    numbers: true
                                                })
                };
                //this.registered_users.set(username, user);
                break;
            }
        }
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
            console.log(`[SSHM] releasing port ${port} for job[${LOG_JOB(job)}]`)
            this.ports[port - this.start] = false;
            this.reserve_count--;
        }
        //this.registered_users.delete(job.user.user);
    }
};

module.exports.ssh_manager = new SSHManager();

