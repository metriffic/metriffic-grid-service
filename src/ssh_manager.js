const LOG_JOB = require('./logging').LOG_JOB
const ERROR = require('./logging').ERROR;
const config = require('./config')

class SSHManager 
{
    constructor() 
    {
        this.ports = [];
        this.ports.length = 5;//config.SSH_PORT_HOST_MAX - config.SSH_PORT_HOST_MIN;
        this.ports.fill(false);
        this.start = config.SSH_PORT_HOST_MIN;        
        this.reserve_count = 0;
    }
    
    reserve_port(job)
    {
        for(let i = 0; i < this.ports.length; ++i) {
            if(this.ports[i]  == false) { 
                this.ports[i] = true;                
                this.reserve_count++;
                const new_port = this.start + i;
                console.log(`[SSHM] reserving port ${new_port} for job[${LOG_JOB(job)}]`)
                return new_port;
            }
        }
        return -1;
    }
    
    release_port(job) 
    {
        const port = job.ssh_port;
        console.log(`[SSHM] releasing port ${port} for job[${LOG_JOB(job)}]`)
        this.ports[port - this.start] = false;
        this.reserve_count--;
    }
};

module.exports.ssh_manager = new SSHManager();

