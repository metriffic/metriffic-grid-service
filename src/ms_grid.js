const Job = require('./ms_job');
const Session = require('./ms_session').Session;

const LOG_JOB = require('./ms_logging').LOG_JOB
const LOG_BOARD = require('./ms_logging').LOG_BOARD
const LOG_SESSION = require('./ms_logging').LOG_SESSION
const ERROR = require('./ms_logging').ERROR

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
            rj.stop();
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
        console.log(`[G] registered board[${LOG_BOARD(brd)}], ` +
                    `total ${this.boards.length} boards.`);
        this.boards.push(brd);
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
    
    submit_session(session_params) 
    {

        session_params.job_complete_cb = (job) => this.job_complete_cb(this, job);

        const session = new Session(session_params);

        const grid = this;
        grid.subscribers.push(session);
        console.log(`[G] subscribed session[${LOG_SESSION(session)}], ` +
                    `total ${grid.subscribers.length} subscribers.`);
        
        // create the test workspace, controller container, etc...
        session.start().then(function(data) {
            grid.schedule();
        }).catch(function(data) {
        });
    }

    dismiss_session(session) 
    {
        // remove from the job queue
        this.running_jobs = this.running_jobs.filter(rj => rj.session.params.id != session.params.id);

        // stop the session (it's container, etc)
        session.stop();

        // remove from the list of subscribed jobs...
        const updated_subscribers = this.subscribers.filter(s => s.params.id != session.params.id);
        if(updated_subscribers.length < this.subscribers.length) {
            console.log(`[G] unsubscribed session[${LOG_SESSION(session)}], ` +
                        `total ${updated_subscribers.length} subscribers.`);
        } else {
            console.log(ERROR(`[G] error: session[${LOG_SESSION(session)}] requested to be unsubscribed can not be found!`));
        }
        this.subscribers = updated_subscribers;
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

            const job = grid.subscribers[0].accept_next();
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
            if( rj.params.uid != job.params.uid) {
                update_running_jobs.push(rj);
            }
        });
        if(update_running_jobs.length == this.running_jobs.length) {
            console.log(ERROR(`[G] error: completed job[${LOG_JOB(job)}] can not be found in the list of running jobs`));
        }
        this.running_jobs = update_running_jobs;

        if(job.session.is_done()) {
            console.log(`[G] all jobs of session[${LOG_SESSION(job.session)}] are done!`);
            this.dismiss_session(job.session);
        }

        this.schedule();
    }
}

module.exports.Grid = Grid;

