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
        this.ports.length = 5;//config.SSH_PORT_HOST_MAX - config.SSH_PORT_HOST_MIN;
        this.ports.fill(false);
        this.start = config.SSH_PORT_HOST_MIN;        
        this.reserve_count = 0;
        this.registered_users = new Map();

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

        this.server.registerAuthenticator(new Authenticators.AuthenticateByPassword((username, password, ctx) => { 
                                                 return ssh_manager.check_password(username, password, ctx)
                                             })
                                         );
        this.server.on('session-created', ({client, session}) => {
            session.on('stream-initialized', (stream) => {
                stream.write('Welcome to the server!\r\n');
          
                if(this.registered_users.has(session.username)) {
                    const user = this.registered_users.get(session.username);
                    user.server_stream = stream;
                    user.client_stream.stdin.pipe(user.server_stream);
                    //Connect remote output to local stdout
                    user.server_stream.pipe(user.client_stream.stdout);
                    user.server_stream.stdout.on('resize', () => {
                        // Let the remote end know when the local terminal has been resized
                        user.client_stream.setWindow(user.server_stream.stdout.rows, user.server_stream.stdout.columns, 0, 0);
                    });
                }
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

    setup_session(job)
    {
        for(let i = 0; i < this.ports.length; ++i) {
            if(this.ports[i]  == false) { 
                this.ports[i] = true;                
                this.reserve_count++;
                const new_port = this.start + i;
                console.log(`[SSHM] reserving port ${new_port} for job[${LOG_JOB(job)}]`)       
                const username = job.params.user; 
                const user = {
                    docker_port: new_port,
                    docker_host: job.board.hostname,
                    username: username,
                    password: password_generator.generate({
                                                    length: 16,
                                                    numbers: true
                                                })
                };
                this.registered_users.set(username, user);
                job.ssh_user = user;
                break;
            }
        }
    }


    start_session(job)
    {
        const username = job.params.user; 
        if(!this.registered_users.has(username)) {
            return;
        }

        const user = this.registered_users.get(username);
       
        var conn = new Client();
        conn.on('close', () => {
            console.log(`[SSHM] connection for job[${LOG_JOB(job)}] is closed`);
        }).on('error', function(err) {
            console.log(ERROR(`[SSHM] Failed to connect to the interactive container: ${err}`));
        }).on('ready', function() {
            console.log(`[SSHM] stream for job[${LOG_JOB(job)}] ready`);
            this.shell({
                term: process.env.TERM,
                rows: process.stdout.rows,
                cols: process.stdout.columns
            }, (err, stream) => {
                if (err) {
                    console.log(ERROR(`[SSHM] Failed capture the shell: ${err}`));
                    // TBD: is throwing ok?
                    throw err;
                }                
                user.client_stream = stream;
                stream.on('close', () => {
                    console.log(`[SSHM] stream for job[${LOG_JOB(job)}] is closed`);
                });
            });
        }).connect({
            host: user.docker_host,
            port: user.docker_port,
            username: "root",
            password: "root",
        });        
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
        this.registered_users.delete(job.user.user);
    }
};

module.exports.ssh_manager = new SSHManager();

