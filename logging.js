const colors = require('colors');

job_str = function(job) 
{
    return job.params.uid.green;
}

board_str = function(board) 
{
    return board.hostname.yellow;
}

session_str = function(session) 
{
    return session.params.uid.brightBlue;
}

container_str = function(container_id) 
{
    return container_id.underline.bold;
}
time_str = function(timestamp) 
{
    const dt = new Date(timestamp);
    return dt.toLocaleString().bold.brightWhite;
}

error_str = function(timestamp) 
{
    return msg.bold.brightRed
}


module.exports.LOG_JOB = job_str;
module.exports.LOG_BOARD = board_str;
module.exports.LOG_SESSION = session_str;
module.exports.LOG_TIME = time_str;
module.exports.LOG_CONTAINER = container_str;
module.exports.ERROR = error_str;

