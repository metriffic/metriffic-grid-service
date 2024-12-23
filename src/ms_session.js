const dockerode = require('dockerode');
const path = require('path');
const fs = require('fs');
const shortid = require('shortid');
const JobType = require('./ms_job').JobType;
const { Job, JobState } = require('./ms_job');
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
    constructor(params, submitted_jobs = [], running_jobs = [])
    {
        this.params = params;
        this.submitted = submitted_jobs;
        this.submitted.forEach(sj => {
            sj.complete_cb = params.job_complete_cb,
            sj.out_file = params.create_session_output_folder()
        })
        this.running = running_jobs;
        this.running.forEach(rj => {
            rj.complete_cb = params.job_complete_cb,
            rj.out_file = params.create_session_output_folder()
        })
        this.total_jobs = this.running.length + this.submitted.length;
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

    async accept_next()
    {
        if(this.submitted.length && this.running.length < this.params.max_jobs) {

            const session = this;
            if(session.total_jobs == session.submitted.length) {
                await metriffic_client.update_session_gql(session.params.name, JobState.running);
            }

            const job = session.submitted.shift();
            session.running.push(job);
            await metriffic_client.update_job_gql(job.params.id, JobState.running);

            //console.log(`[S] accepting job[${LOG_JOB(job)}] from session [${LOG_SESSION(this)}], ` +
            //            `total jobs: ${this.submitted.length} submitted, ` +
            //            `${this.running.length} running.`);
            return job;
        }
        return null;
    }

    async on_complete(job)
    {
        const running_updated = [];
        this.running.forEach(async (running_job) => {
            if( running_job.params.id == job.params.id) {

                console.log(`[S] removed completed job [${LOG_JOB(job)}], \n`,
                            `\t\tsubmitted\t${LOG_TIME(job.submit_timestamp)}, \n`,
                            `\t\tstarted  \t${LOG_TIME(job.start_timestamp)} \n`,
                            `\t\tfinished \t${LOG_TIME(job.complete_timestamp)}`);
                await metriffic_client.update_job_gql(running_job.params.id, job.state);
            } else {
                running_updated.push(running_job);
            }
        });
        if(running_updated.length == this.running.length) {
            console.log(ERROR(`[S] error: completed job [${LOG_JOB(job)}] can not be `,
                        `found in the list of running jobs`));
        }
        this.running = running_updated;
    }

    async start()
    {
        const params = this.params;

        console.log(`[S] starting session [${LOG_SESSION(this)}]`);

        const [folder, output_folder] = this.create_session_output_folder();
        console.log(`[S] created folders: ${folder}, ${output_folder}`);

        const jobs = [];

        if(this.is_batch()) {
            for(let dataset_chunk = 0; dataset_chunk < params.dataset_split; ++dataset_chunk) {
                    const jparams = {
                        session_name    : params.name,
                        platform_id     : params.platform_id,
                        username        : params.username,
                        user_id         : params.user_id,
                        user_key        : params.user_key,
                        dataset_chunk   : dataset_chunk,
                        command         : params.command,
                        complete_cb     : params.job_complete_cb,
                        out_file        : path.join(output_folder, 'job.'+dataset_chunk+'.log'),
                        userspace       : path.join(config.USERSPACE_NFS_DIR_ROOT, params.username),
                        publicspace     : config.PUBLICSPACE_NFS_DIR_ROOT,
                        docker_registry : params.docker_registry,
                        docker_image    : params.docker_image,
                        docker_options  : params.docker_options,
                        type            : JobType.batch,
                        exclusive       : true,
                    };
                    // TBD: review the path
                    //bindings.push(`${path.resolve(ds)}:/input/${ds}`);
                    jobs.push(new Job(jparams));
            };
            await this.submit_batch(jobs);
        } else
        if(this.is_interactive()) {
                const jparams = {
                    session_name    : params.name,
                    platform_id     : params.platform_id,
                    username        : params.username,
                    user_id         : params.user_id,
                    user_key        : params.user_key,
                    dataset_chunk   : null,
                    command         : [],
                    complete_cb     : params.job_complete_cb,
                    out_file        : path.join(output_folder, 'job.interactive.log'),
                    userspace       : path.join(config.USERSPACE_NFS_DIR_ROOT, params.username),
                    publicspace     : config.PUBLICSPACE_NFS_DIR_ROOT,
                    docker_registry : params.docker_registry,
                    docker_image    : params.docker_image,
                    docker_options  : params.docker_options,
                    type            : JobType.interactive,
                    exclusive       : true,
                };
            await this.submit_interactive(new Job(jparams));
        } else {
            console.log(ERROR(`[S] error: unknown session type: [${this.params.type}]...`));
            // TBD: make sure the session is canceled
        }
    }

    async stop()
    {
        const session = this;
        console.log('[S] stopping the session');
        console.log(`[S] submitted but not yet running jobs to be canceled: ${this.submitted.length}`);
        this.submitted.forEach(submitted_job => console.log(`[S]  -> canceling job: ${LOG_JOB(submitted_job)}`));
        this.submitted = [];
        this.running.forEach(async (running_job) => {
            console.log(`[S] canceling running job ${LOG_JOB(running_job)}`);
            running_job.cancel();
            await metriffic_client.update_job_gql(running_job.params.id, JobState.canceled);
        });

        const session_state = (this.running.length == 0 && this.submitted.length == 0) ? JobState.completed : JobState.canceled;
        await metriffic_client.update_session_gql(session.params.name, session_state);
    }

    create_session_output_folder()
    {
        const folder = path.join(config.USERSPACE_DIR_ROOT, this.params.username, 'sessions', this.session_id());
        const output_folder = path.join(folder, 'output');
        fs.mkdirSync(folder, { recursive: true });
        fs.mkdirSync(output_folder, { recursive: true });
        return [folder, output_folder];
    }

    async submit_batch(jobs)
    {
        this.total_jobs = jobs.length;
        const session = this;

        try {
            // update the BE
            const mutation_submit_job = gql`
            mutation ms($sessionId: Int!, $datasetSplit: Int) {
                jobsCreate(sessionId: $sessionId, datasetSplit: $datasetSplit)
                { id datasetChunk }
            }`;
            const job_create = await metriffic_client.gql.mutate({
                mutation: mutation_submit_job,
                variables: { sessionId: session.params.id,
                             datasetSplit: jobs.length }
            })
            const submitted_be_jobs = job_create.data.jobsCreate;
            jobs.forEach(job => {
                console.log(`[S] trying to submit batch job ${JSON.stringify(job, null, 4)}`);
                console.log(`[S] response with submission ${JSON.stringify(submitted_be_jobs, null, 4)}`);
                const sbej = submitted_be_jobs.find(j => {
                    return j.datasetChunk == job.params.dataset_chunk;
                });
                job.session = session;
                job.params.id = sbej.id;
                job.submit_timestamp = Date.now();
                // vazk added to submitted!
                session.submitted.push(job);
                console.log(`[S] submitted job [${LOG_JOB(job)}] for session[${LOG_SESSION(session)}], `+
                            `total submitted: ${session.submitted.length} jobs`);
            });
        } catch(err) {
            console.log(ERROR(`[S] failed to submit a job from session[${LOG_SESSION(session)}]: ${err}.`));
        }
    }

    async submit_interactive(job)
    {
        this.total_jobs = 1
        const session = this;

        try {
            const mutation_submit_job = gql`
            mutation ms($sessionId: Int!, $datasetSplit: Int) {
                jobsCreate(sessionId: $sessionId, datasetSplit: $datasetSplit)
                { id datasetChunk }
            }`;
            const job_create = await metriffic_client.gql.mutate({
                mutation: mutation_submit_job,
                variables: { sessionId: session.params.id,
                             datasetSplit: undefined }
            })
            const submitted_be_jobs = job_create.data.jobsCreate;
            
            console.log(`[S] trying to submit interactive job ${JSON.stringify(job, null, 4)}`);
            console.log(`[S] response with submission ${JSON.stringify(submitted_be_jobs, null, 4)}`);
            const sbej = submitted_be_jobs.find(j => {
                return j.datasetChunk == job.params.dataset_chunk;
            });
            job.session = session;
            job.params.id = sbej.id;
            job.submit_timestamp = Date.now();
            // vazk added to submitted!
            session.submitted.push(job);
            console.log(`[S] submitted interactive job [${LOG_JOB(job)}] for session[${LOG_SESSION(session)}]`);
        } catch(err) {
            console.log(ERROR(`[S] failed to submit the job from interactive session[${LOG_SESSION(session)}]: ${err}.`));
        }
    }
};



module.exports.Session = Session;
