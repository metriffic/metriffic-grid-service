
const stop_container = async function(docker, cntr) 
{
        console.log(`stopping container ${cntr.Id}....`);
        const container = docker.getContainer(cntr.Id);

        console.log('STOPPING');
        container.stop().then(function(data){
            console.log('DONE');

        }).catch(function(data) {
            console.log('FAILED TO STOP');
            return container.remove();
        }).finally(function(data){
            console.log('FINALLY');
        });
}

module.exports.stop_container = stop_container;
