const dockerode = require('dockerode');
const LOG_BOARD = require('./ms_logging').LOG_BOARD;

class Board 
{
    constructor(params) 
    {
        this.platform = params.platform;
        this.platform_docker = params.platform_docker;
        this.hostname = params.hostname;
        this.used = false;
        this.docker = new dockerode({protocol: 'http', host: params.hostname, port: 2375});
    }
    
    use() 
    {
        console.log(`[B] using board [${LOG_BOARD(this)}]`);
        this.used = true;
    }

    release()
    {
        console.log(`[B] releasing board [${LOG_BOARD(this)}]`);
        this.used = false;
    }

    is_used() 
    {
        return this.used;
    }
};

module.exports.Board = Board;

