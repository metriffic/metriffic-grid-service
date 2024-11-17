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
    constructor(params)
    {
        this.params = params;
        this.submitted = [];
        this.running = [];
        this.total_jobs = 0;
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
                try {
                    const mutation_running_session = gql`
                    mutation running_session($name: String!, $state: String!) {
                        sessionUpdateState(name: $name, state: $state)
                        { id }
                    }`;
                    const session_update = await metriffic_client.gql.mutate({
                                    mutation: mutation_running_session,
                                    variables: { name: session.params.name,
                                                 state: JobState.running }
                                });
                // nothing
                } catch(err) {
                    console.log(ERROR(`[S] failed to update BE with 'running session' request [${LOG_SESSION(session)}]: ${err}.`));
                }
            }

            const job = session.submitted.shift();
            session.running.push(job);
            try {
                // update the BE
                const mutation_cancel_job = gql`
                mutation cancel_job($jobId: Int!, $state: String!) {
                    jobUpdate(id: $jobId, state: $state)
                    { id }
                }`;
                const job_update = await metriffic_client.gql.mutate({
                            mutation: mutation_cancel_job,
                            variables: { jobId: job.params.id,
                                         state: JobState.running }
                        })
            } catch(err) {
                console.log(ERROR(`[S] failed to update BE with 'running job' request [${LOG_JOB(job)}]: ${err}.`));
            }

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

                try {
                    // update the BE
                    const mutation_complete_job = gql`
                    mutation cancel_job($jobId: Int!, $state: String!) {
                        jobUpdate(id: $jobId, state: $state)
                        { id }
                    }`;
                    const job_update = await metriffic_client.gql.mutate({
                                mutation: mutation_complete_job,
                                variables: { jobId: running_job.params.id,
                                             state: job.state }
                            })
                    // nothing
                } catch(err) {
                    console.log(ERROR(`[S] failed to update BE with 'complete job' request [${LOG_JOB(running_job)}]: ${err}.`));
                }
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
            params.datasets.forEach( ds => {
                    const jparams = {
                        session_name    : params.name,
                        platform_id     : params.platform_id,
                        username        : params.username,
                        user_id         : params.user_id,
                        user_key        : params.user_key,
                        dataset         : ds,
                        command         : params.command,
                        complete_cb     : params.job_complete_cb,
                        out_file        : path.join(output_folder, 'job.'+ds+'.log'),
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
                });
        } else
        if(this.is_interactive()) {
                const jparams = {
                    session_name    : params.name,
                    platform_id     : params.platform_id,
                    username        : params.username,
                    user_id         : params.user_id,
                    user_key        : params.user_key,
                    dataset         : 'interactive',
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
            jobs.push(new Job(jparams));
        } else {
            console.log(ERROR(`[S] error: unknown session type: [${this.params.type}]...`));
            // TBD: make sure the session is canceled
        }
        await this.submit(jobs);
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
            try {
                // update the BE
                const mutation_cancel_job = gql`
                mutation cancel_job($jobId: Int!, $state: String!) {
                    jobUpdate(id: $jobId, state: $state)
                    { id }
                }`;
                const job_update = await metriffic_client.gql.mutate({
                    mutation: mutation_cancel_job,
                    variables: { jobId: running_job.params.id,
                                state: JobState.canceled }
                })
                // nothing
            } catch(err) {
                console.log(ERROR(`[S] failed to update BE with 'cancel job' request [${LOG_JOB(running_job)}]: ${err}.`));
            }
        });

        const session_state = (this.running.length == 0 && this.submitted.length == 0) ? JobState.completed : JobState.canceled;

        try {
            const mutation_stop_session = gql`
            mutation stop_session($name: String!, $state: String!) {
                sessionUpdateState(name: $name, state: $state)
                { id }
            }`;
            const session_stop = await metriffic_client.gql.mutate({
                mutation: mutation_stop_session,
                variables: { name: session.params.name,
                             state: session_state }
            })
            // nothing
        } catch(err) {
            console.log(ERROR(`[S] failed to update BE with 'cancel session' request [${LOG_SESSION(session)}]: ${err}.`));
        }
    }

    create_session_output_folder()
    {
        const folder = path.join(config.USERSPACE_DIR_ROOT, this.params.username, 'sessions', this.session_id());
        const output_folder = path.join(folder, 'output');
        fs.mkdirSync(folder, { recursive: true });
        fs.mkdirSync(output_folder, { recursive: true });
        return [folder, output_folder];
    }

    async submit(jobs)
    {
        this.total_jobs = jobs.length;
        const session = this;

        try {
            // update the BE
            const datasets = jobs.map(j => {
                return j.params.dataset;
            });

            const mutation_submit_job = gql`
            mutation ms($sessionId: Int!, $datasets: String!) {
                jobCreate(sessionId: $sessionId, datasets: $datasets)
                { id dataset }
            }`;
            const job_create = await metriffic_client.gql.mutate({
                mutation: mutation_submit_job,
                variables: { sessionId: session.params.id,
                             datasets: JSON.stringify(datasets) }
            })
           const submitted_be_jobs = job_create.data.jobCreate;
           jobs.forEach(job => {
                console.log(`[S] trying to submit job ${job}`);
                const sbej = submitted_be_jobs.find(j => {
                    return j.dataset == job.params.dataset;
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
};



module.exports.Session = Session;
