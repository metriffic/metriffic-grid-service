const { ShellServer, Authenticators } = require('ssh2-shell-server');
const { Client} = require('ssh2');
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
        this.ports.length = 5;//config.SSH_PORT_HOST_MAX - config.SSH_PORT_HOST_MIN;
        this.ports.fill(false);
        this.start = config.SSH_PORT_HOST_MIN;        
        this.reserve_count = 0;
        this.registered_users = new Map();


        this.client_stream = null;
        this.server_stream = null;
        this.server = new ShellServer({
            hostKeys: [],
            hostKeys: [{
                key: fs.readFileSync('host.key'),
                passphrase: 'blabla',
            }],
            port: config.SSH_EXTERNAL_PORT,
        });
        this.setup_session_manager();
    }

    setup_session_manager()
    {
        const ssh_manager = this;

        this.server.registerAuthenticator(new Authenticators.AuthenticateByPassword(this.check_password));

        const server_stream = this.server_stream;
        const client_stream = this.client_stream;

        this.server.on('session-created', ({client, session}) => {
            session.on('stream-initialized', (stream) => {
                ssh_manager.server_stream = stream;
                stream.write('Welcome to the server!\r\n');
          
                client_stream.stdin.pipe(server_stream);
          
                //Connect remote output to local stdout
                server_stream.pipe(client_stream.stdout);
                server_stream.stdout.on('resize', () => {
                    // Let the remote end know when the local terminal has been resized
                    client_stream.setWindow(server_stream.stdout.rows, server_stream.stdout.columns, 0, 0);
                });
            });
          });
           
        this.server.listen()
        .then(() => {
            console.log(`[SSHM] Listening on port ${config.SSH_EXTERNAL_PORT}...`);
        });          
    }
    
    check_password(username, password, ctx)
    {
        return this.registered_users.has(username) && 
               this.registered_users.get(username).password === password;
    }

    start_session(job)
    {
        for(let i = 0; i < this.ports.length; ++i) {
            if(this.ports[i]  == false) { 
                this.ports[i] = true;                
                this.reserve_count++;
                const new_port = this.start + i;
                console.log(`[SSHM] reserving port ${new_port} for job[${LOG_JOB(job)}]`)        
                const user = {
                    port: new_port,
                    username: job.params.user,
                    password:  password_generator.generate({
                                                    length: 16,
                                                    numbers: true
                                                })
                };
                this.registered_users.set(job.params.user, user);
                job.ssh_user = user;
                break;
            }
        }
    }

    end_session(job) 
    {
        if(job.port == null) {
            return;
        }
        if(job.user.port) {
            console.log(`[SSHM] releasing port ${port} for job[${LOG_JOB(job)}]`)
            this.ports[port - this.start] = false;
            this.reserve_count--;
        }
        this.registered_users.delete(job.user.user);
    }
};

module.exports.ssh_manager = new SSHManager();

