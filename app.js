const Job     = require('./job').Job;
const Session = require('./session').Session;
const Board   = require('./board').Board;
const Grid    = require('./grid').Grid;

var gparams = {
    platform : 'RPI3',
    platform_docker: 'ubuntu-run',
    tick_ms : 8000,
};

const grid = new Grid(gparams);

job_complete_cb = (job) => {
    grid.on_job_complete(job);
}

{
    // instantiate the board
    grid.register_board(new Board({
                    platform: gparams.platform, 
                    platform_docker: gparams.platform_docker,
                    hostname: 'metriffic-rpi3-1'
                }));
    grid.register_board(new Board({
                    platform: gparams.platform, 
                    platform_docker: gparams.platform_docker,
                    hostname: 'metriffic-rpi3-2'
                }));
    grid.register_board(new Board({
                    platform: gparams.platform, 
                    platform_docker: gparams.platform_docker,
                    hostname: 'metriffic-rpi3-3'
                }));

    // start the service
    grid.start();

    // create a job-manager and submit jobs
    const session_params = {
        // test configuration
        user: 'vazkus',
        project: 'test-project',
        uid: 'bla',
        datasets: ['ds','ds1','ds2','ds3',
                   'ds4','ds5','ds6',
                   'ds7','ds8','ds9',
                   'ds10','ds11','ds12'],

        // system configuration
        server_docker: 'ubuntu-provider-collector',
        docker_registry: '192.168.86.244:5000',

        // job function
        job_command: ['/bin/bash', '-c', 'export'],
        job_complete_cb: job_complete_cb,

        // runtime configuration: 
        //   maximum number of parallel docker threads 
        //   on separate boards
        max_jobs: 5,
    };

    const session = new Session(session_params);

    grid.subscribe_session(session);


    //setTimeout(() => {console.log('XXX')}, tick_ms);

    //grid.stop();
}



