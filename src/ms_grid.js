const Job = require('./ms_job');
const Session = require('./ms_session').Session;
const {
    LOG_JOB,
    LOG_BOARD,
    LOG_SESSION,
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

    start() 
    {
        console.log(`[G] starting grid with following parameters ${this.name}`);
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
        console.log(`[G] registered board[${LOG_BOARD(brd)}], ` +
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

    submit_session(session_params) 
    {
        session_params.job_complete_cb = (job) => this.job_complete_cb(this, job);

        const session = new Session(session_params);

        this.subscribers.push(session);
        console.log(`[G] subscribed session[${LOG_SESSION(session)}], ` +
                    `total ${this.subscribers.length} subscribers.`);
        
        session.start();
        this.schedule();
    }

    dismiss_session(session) 
    {
        // stop the session (it's container, etc)
        session.stop();
        // remove it from the list of subscribers...
        const session_index = this.subscribers.indexOf(session);
        if (session_index > -1) {
            this.subscribers.splice(session_index, 1);
            console.log(`[G] dismissed session[${LOG_SESSION(session)}]...`);
        } else {
            console.log(ERROR(`[G] error: session[${LOG_SESSION(session)}] is not in the subscribers list!`));
        }
    }

    schedule() 
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
                this.dismiss_session(session);
                continue;
            }

            const job = session.accept_next();
            
            // TBD: update the state of the session here!

            if(job) {
                grid.running_jobs.push(job);
                //[FIXME]
                job.start(this.select_free_board());
                num_skipped = 0;
            } else {
                num_skipped++;
            }
            grid.subscribers.push(grid.subscribers.shift());

        }
    }

    on_job_complete(job) 
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

        this.schedule();
    }
}

module.exports.Grid = Grid;

