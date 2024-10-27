const dockerode = require('dockerode');
const LOG_BOARD = require('./logging').LOG_BOARD;

class Board 
{
    constructor(params) 
    {
        this.platform = params.platform;
        this.hostname = params.hostname;
        this.ip = params.ip;
        this.used = false;
        this.docker = new dockerode({protocol: 'http', host: params.ip, port: 2375});
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

