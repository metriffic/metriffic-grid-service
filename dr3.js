const Docker = require('dockerode');
const path = require('path');

var remote_docker = new Docker({protocol: 'http', host: 'metriffic', port: 2375});


const stop_container = async function(container) 
{
    console.log(`stopping container ${container.Id}....`);
    await remote_docker.getContainer(container.Id).stop();
}

var board_container = null;

remote_docker.listContainers({
    all: true
}).then(function(containers) {
    const promises = []
    containers.forEach(container => { promises.push(stop_container(container)) });
    return promises;
}).then(function(promises) {
    return Promise.all(promises);// .then(function(data){console.log('all done...')});
}).then(function(data){
    console.log('all done...');
}).then(function(data){
    //console.log('AAAA', `${path.resolve('badam')}:/badam`);
    return remote_docker.createContainer({
        Image: '192.168.86.244:5000/ubuntu-build',
        name: 'brd.bladabla',
        Cmd: ['/bin/bash'],
        Tty: true,
        Volumes:{'/badam': {}},
        HostConfig: {
            Binds: ['/home/vazgen/badam:/badam'],
            AutoRemove: true
        }});
}).then(function(container) {
    console.log('start');
    board_container = container;
    return container.start();
}).then(function(data) {
    console.log('stop');
    return board_container.stop();
}).then(function(data) {
    console.log('done');
});

return;


bla = async function() 
{


    const dockers = await remote_docker.listContainers({all: true});
    dockers.forEach(containr => { stop_container(container); });


    const container = await remote_docker.createContainer({
        Image: '192.168.86.244:5000/ubuntu-build',
        name: 'brd.bladabla',
        Cmd: ['/bin/bash'],
        Tty: true,
        HostConfig: {
            AutoRemove: true
        }
    });

    await container.start();

    /*const options = {
        Cmd: ['/bin/bash', '-c', 'export'],
        AttachStdout: true,
        AttachStderr: true,
    }

    /*await container.exec(options, async function(err, exec) {
        if (err) return;
        await exec.start(async function(err, stream) {
            if (err) return;
            container.modem.demuxStream(stream, process.stdout, process.stderr);
            await exec.inspect(function(err, data) {
                if (err) return;
                console.log(data);
            });
        });
    });*/
    const terminate_container = async () =>
    {
        console.log('stop');
        await container.stop();
        console.log('rm');
        await container.remove();
    }
    const on_stream_finished = async () =>
    {
        console.log('stream finished!');
        //terminate_container();
    }
    const on_stream_progress = async () => 
    {
        console.log('stream progress...');
        //terminate_container();
    }
    const execute = async function(cntr, command) {
        return exec;
    }

    const exec = await container.exec({
        Cmd: ['/bin/bash', '-c', 'ls /'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: true
    });

    await exec.start(async (err, stream) => {
        if (err) {
            console.log('reject');
            return reject();
        }
        //container.modem.demuxStream(stream, out_stream, out_stream);
        console.log('predemux');
        container.modem.demuxStream(stream, process.stdout, process.stderr);
        console.log('postdemux');
    });

    console.log('XXXX');
    //await exec.inspect(async (err, data) => {
    //    console.log('YYYY', err, data);
    //});

    //stream_promise.then(on_stream_success);
    //stream_promise.catch(on_stream_error);
    //await stream_promise;
}

bla();
