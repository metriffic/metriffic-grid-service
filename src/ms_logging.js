const colors = require('colors');

function job_str(job) 
{
    return job.params.uid.green;
}

function board_str(board) 
{
    return board.hostname.yellow;
}

function session_str(session) 
{
    return session.params.name.brightBlue;
}

function container_str(container_id) 
{
    return container_id.underline.bold;
}
function time_str(timestamp) 
{
    const dt = new Date(timestamp);
    return dt.toLocaleString().bold.brightWhite;
}

function error_str(msg) 
{
    return msg.bold.brightRed
}


module.exports.LOG_JOB = job_str;
module.exports.LOG_BOARD = board_str;
module.exports.LOG_SESSION = session_str;
module.exports.LOG_TIME = time_str;
module.exports.LOG_CONTAINER = container_str;
module.exports.ERROR = error_str;

