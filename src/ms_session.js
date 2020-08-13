const dockerode = require('dockerode');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');
const JobType = require('./ms_job').JobType;
const Job = require('./ms_job').Job;
const config = require('./config')

const gql = require('graphql-tag');
const metriffic_client = require('./metriffic_gql').metriffic_client

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
            if( rj.params.id == job.params.id) {
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

        const [folder, output_folder] = this.create_session_output_folder();
        console.log(`[S] created folders: ${folder}, ${output_folder}`);

        // prepare volumes and binding for the provide-collector container...
        //const bindings = [];
        if(this.is_batch()) {
            params.datasets.forEach( ds => {
                    const jparams = {
                        session_name    : params.name,
                        user            : params.user,
                        dataset         : ds,
                        command         : params.command,
                        complete_cb     : params.job_complete_cb,
                        out_file        : path.join(output_folder, 'job.'+ds+'.log'),
                        workspace       : path.join(config.USERSPACE_NFS_DIR_ROOT, params.user),    
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
                        session_name    : params.name,
                        user            : params.user,
                        command         : [],
                        complete_cb     : params.job_complete_cb,
                        out_file        : path.join(output_folder, 'job.interactive.log'),
                        workspace       : path.join(config.USERSPACE_NFS_DIR_ROOT, params.user),
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

    create_session_output_folder() 
    {
        const folder = path.join(config.USERSPACE_DIR_ROOT, this.params.user, 'sessions', this.session_id());
        const output_folder = path.join(folder, 'output');
        fs.mkdirSync(folder, { recursive: true });
        fs.mkdirSync(output_folder, { recursive: true });
        return [folder, output_folder];
    }

    submit(job) 
    {
        const session = this;
        job.session = session;
        
        const mutation_submit_job = gql`
        mutation ms($sessionId: Int!, $dataset: String!) { 
            jobCreate(sessionId: $sessionId, dataset: $dataset) 
            { id } 
        }`;
        metriffic_client.gql.mutate({
            mutation: mutation_submit_job,
            variables: { sessionId: this.params.id, 
                        dataset: job.params.dataset }
        }).then(function(ret) {
            job.params.id = ret.data.jobCreate.id;
            job.submit_timestamp = Date.now();
            session.submitted.push(job);
            console.log(`[S] submitted job [${LOG_JOB(job)}] for session[${LOG_SESSION(session)}], `+ 
                        `total submitted: ${session.submitted.length} jobs`);
        }).catch(function(err){
            //console.log('ERROR in jobCreate', err);
        });
    }
};



module.exports.Session = Session;
