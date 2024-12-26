const path = require('path');
const config = require('./config')
const metriffic_client = require('./metriffic_gql').metriffic_client
const { Job, JobState } = require('./ms_job');
const Session = require('./ms_session').Session;
const {
    LOG_JOB,
    LOG_BOARD,
    LOG_SESSION,
    LOG_IMAGE,
    ERROR
 } = require('./logging')

class Grid
{
    constructor(params)
    {
        this.name = params.name;
        this.id = params.id;

        this.boards = [];

        this.subscribers = [];
        this.running_jobs = [];

    }

    job_complete_cb(grid, job)
    {
        grid.on_job_complete(job);
    }

    select_free_board()
    {
        for(const bi in this.boards) {
            const brd = this.boards[bi];
            if(!brd.is_used()) {
                brd.use();
                return brd;
            }
        }
        return null;
    }

    async start(unfinished_sessions)
    {
        console.log(`[G] starting grid with following parameters: ${this.name}`);
        console.log(`[G] unfinished sessions: [${JSON.stringify(unfinished_sessions, null, 4)}]`);

        const running_containers = await this.collect_running_containers();

        // match the unfinished session from the backed to the running containers on the grid...
        // RULES:
        //   1. if a BE running job with no container => end the job in BE
        //   2. if a BE running job with container => add to running list
        //   3. if a BE scheduled job with no container => add the session to the queue
        //   4. if a running container with no job => push to orphan list
        //   5. if a running container for scheduled session => change BE scheduled to running, same for job
        unfinished_sessions?.forEach(async (session) => {

            const session_jobs = await metriffic_client.get_jobs_gql(session.session_id);
            if(!session_jobs) return;

            console.log('SESSION_JOBS', session_jobs)
            const running_jobs = [];
            const submitted_jobs = [];
            const grid = this;

            session_jobs.forEach(async (job) => {
                if(job.state === JobState.completed || job.state === JobState.canceled) return;

                const fi = running_containers.findIndex(bc => bc.session_name === session.session_name &&
                                                              bc.job_id === job.id);
                if(job.state === JobState.submitted) {
                    if(fi == -1) {
                        // case #3
                        const jparams = grid.build_job_params(job, session);
                        submitted_jobs.push(new Job(jparams));
                    } else {
                        // case #5
                        const jparams = grid.build_job_params(job, session);
                        running_jobs.push(new Job(jparams));
                        running_containers.splice(fi, 1);
                        await metriffic_client.update_job_gql(job.id, JobState.running);
                    }
                } else
                if(job.state === JobState.running) {
                    if(fi == -1) {
                        console.log('CHKPT case#1');
                        // case #1
                        await metriffic_client.update_job_gql(job.id, JobState.completed);
                    } else {
                        // case #2
                        const jparams = grid.build_job_params(job, session);
                        running_jobs.push(new Job(jparams));
                        running_containers.splice(fi, 1);
                    }
                }
            })
            // update the session state
            if(running_jobs.length || submitted_jobs.length) {
                // non-empty session
                if(running_jobs.length && session.state != JobState.running) {
                    await metriffic_client.update_session_gql(session.session_name, JobState.running);
                }
                // construct the session object
                const s = new Session(session, submitted_jobs, running_jobs);
                // register it's running jobs here
                this.running_jobs.concat(s.running);
                // add it as a subscriber
                this.subscribers.push(s);
            } else {
                // no jobs left to be done for this session, finish it.
                metriffic_client.update_session_gql(session.session_name, JobState.completed);
            }
        })
        console.log('CHKPT case#4');
        // case #4: the remaining containers are orphans
        this.kill_orphan_containers(running_containers);

        // kick start the grid
        await this.schedule();
    }

    stop()
    {
        console.log('[G] stoping grid');
        // stop all running jobs
        this.running_jobs.forEach(function(rj) {
            rj.cancel();
        });
        this.running_jobs = [];
        // stop all subscribed job-managers
        this.subscribers.forEach(function(jm) {
            jm.stop();
        });
        this.subscribers = [];
    }

    register_board(brd)
    {
        this.boards.push(brd);
        console.log(`[G] registered board[${LOG_BOARD(brd)}, ${brd.ip}], ` +
                    `total ${this.boards.length} boards.`);
    }
    unregister_board(brd)
    {
        const updated_boards = this.boards.filter(b => b.hostname != brd.hostname);
        if(updated_boards.length < this.boards.length) {
            console.log(`[G] unregistered board[${LOG_BOARD(brd)}], ` +
                        `total ${updated_boards.length} boards.`);
        } else {
            console.log(ERROR(`[G] error: board[${LOG_BOARD(brd)}] requested to be unregistered can not be found!`));
        }
        this.boards = updated_boards;
    }
    get_session(id)
    {
        return this.subscribers.find(session =>
                                (session.params.id == id));
    }

    async submit_session(session_params)
    {
        session_params.job_complete_cb = (job) => this.job_complete_cb(this, job);

        const session = new Session(session_params);

        this.subscribers.push(session);
        console.log(`[G] subscribed session[${LOG_SESSION(session)}], ` +
                    `total ${this.subscribers.length} subscribers.`);

        await session.start()
        await this.schedule();
    }

    async dismiss_session(session)
    {
        // stop the session (it's container, etc)
        await session.stop();
        // remove it from the list of subscribers...
        const session_index = this.subscribers.indexOf(session);
        if (session_index > -1) {
            this.subscribers.splice(session_index, 1);
            console.log(`[G] dismissed session[${LOG_SESSION(session)}]...`);
        } else {
            console.log(ERROR(`[G] error: session[${LOG_SESSION(session)}] is not in the subscribers list!`));
        }
    }

    save_session(session, docker_image_name)
    {
        // this is only defined for interactive session with a single job, so [0] is fine.
        const job = session.running[0];
        if(job) {
            console.log(`[G] saving docker-image for session[${LOG_SESSION(session)}] as ${LOG_IMAGE(docker_image_name)}`);
            job.save(docker_image_name);
        } else {
            console.log(ERROR(`[G] error: can not save session[${LOG_SESSION(session)}], no running job!`));
        }
    }

    async schedule()
    {
        const grid = this;
        console.log(`[G] scheduling... boards: ${grid.boards.length}, `,
                    `subscribers: ${grid.subscribers.length}, `,
                    `running jobs: ${grid.running_jobs.length}`);
        if(grid.running_jobs.length > grid.boards.length) {
            console.log(ERROR(`[G] error: more running jobs than boards!`));
            return;
        }

        var num_skipped = 0;
        // while not at full capacity and there are still jobs to submit
        while(grid.running_jobs.length < grid.boards.length &&
              num_skipped < grid.subscribers.length ) {

            const session = grid.subscribers[0];

            if(grid.subscribers[0].is_done()) {
                await this.dismiss_session(session);
                continue;
            }

            const job = await session.accept_next();

            // TBD: update the state of the session here!

            if(job) {
                grid.running_jobs.push(job);
                //[FIXME]
                job.start(this.select_free_board());
                num_skipped = 0;
            } else {
                num_skipped++;
            }
            // move this session to the back of the queue
            // [questionable strategy, rething this!]
            grid.subscribers.push(grid.subscribers.shift());
        }
    }

    async on_job_complete(job)
    {
        job.complete_timestamp = Date.now();
        job.session.on_complete(job);

        console.log('[G] processing job complete...');

        const update_running_jobs = [];
        this.running_jobs.forEach(rj => {
            if( rj.params.id != job.params.id) {
                update_running_jobs.push(rj);
            }
        });
        if(update_running_jobs.length == this.running_jobs.length) {
            console.log(ERROR(`[G] error: completed job[${LOG_JOB(job)}] can not be found in the list of running jobs`));
        }
        this.running_jobs = update_running_jobs;

        // if(job.session.is_done()) {
        //     console.log(`[G] all jobs of session[${LOG_SESSION(job.session)}] are done!`);
        //     this.dismiss_session(job.session);
        // }

        await this.schedule();
    }



    async kill_orphan_containers(orphan_containers)
    {
        const grid = this;
        orphan_containers.forEach(async (oc) => {
            console.log(`[M] Cleaning up orphan container ${oc.container_id}`);
            const board = grid.boards.find(b => b.hostname == oc.board_name);
            if (!board) {
                console.log(`[G] board ${oc.board_name} not found, skipping cleanup...`);
                return;
            }
            try {
                const container = board.docker.getContainer(oc.container_id);
                try {
                    await container.stop();
                } catch(err) {
                    if (err.statusCode === 304) {
                        console.log(`[G] container [${oc.container_id}] already stopped.`);
                    } else {
                        console.error(ERROR(`[G] error stopping container [${oc.container_id}]: ${err}`));
                    }
                }
                await board.docker.pruneContainers();
                await board.docker.pruneVolumes();
                console.log(`[G] container [${oc.containers_id}] is successfully killed.`);
            } catch(err) {
                console.log(ERROR(`[G] error killing container on board[${LOG_BOARD(board)}]: ${err}`));
            }
            console.log(`[G] container cleanup done for board[${LOG_BOARD(board)}].`);
        });
    }

    async collect_running_containers()
    {
        const platform_name = this.name;

        // const get_running_container_info = (container) => {
        //     const str = container.Names[0]
        //     const regex = /^(?:\/)?session-([^.]+(?:\.[^.]+)*?)\.job-(\d+)$/;
        //     const match = str.match(regex);
        //     return match ? { session_name: match[1],
        //                      job_id: match[2],
        //                      container_id: container.Id }
        //                  : { container_id: container.Id };
        // }
        const get_running_container_info = (container) => {
            const container_name = container?.Names?.[0];
            if(!container_name) return {container_id: container?.Id};

            const match = container_name.match(/^(?:\/)?session-([^.]+(?:\.[^.]+)*?)\.job-(\d+)$/);
            const job_id = match && parseInt(match[2], 10);
            return job_id && Number.isInteger(job_id)
              ? { session_name: match[1], job_id, container_id: container.Id }
              : { container_id: container.Id };
          };

        console.log(`[G] collecting running jobs for grid[${platform_name}]`);
        const running_containers = [];
        const promises = this.boards.map( async (board) => {
            try {
                const containers = await board.docker.listContainers({ all: true });
                containers.forEach((container) => {
                    console.log(`[G] found running container on grid[${platform_name}]: [${JSON.stringify(container, null, 4)}]`);
                    const info = get_running_container_info(container);
                    console.log(`[G] container data: [${JSON.stringify(info, null, 4)}]`);
                    running_containers.push({board_name: board.hostname, ...info});
                });
            } catch (err) {
                console.log(ERROR(`[G] failed to list containers for board[${LOG_BOARD(board)}], ${err}`));
            }
        });

        await Promise.all(promises);
        console.log(`[G] all containers for grid[${platform_name}] boards: ` +
                        `${running_containers?.length ? JSON.stringify(running_containers, null, 4) : 'n/a'}`);
        return running_containers;
    }

    build_job_params(job, session) {
        return {
                session_name    : session.session_name,
                platform_id     : session.platform_id,
                username        : session.username,
                user_id         : session.user_id,
                user_key        : session.user_key,
                dataset         : job.dataset,
                command         : session.command,
                userspace       : path.join(config.USERSPACE_NFS_DIR_ROOT, session.username),
                publicspace     : config.PUBLICSPACE_NFS_DIR_ROOT,
                docker_registry : config.DOCKER_REGISTRY_HOST,
                docker_image    : session.docker_image,
                docker_options  : session.docker_options,
                type            : session.session_type,
                exclusive       : true,
        }
    }

}

module.exports.Grid = Grid;

