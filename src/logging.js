const colors = require('colors');

function user_str(username) 
{
    return username.bold.brightWhite;
}

function job_str(job) 
{
    return (job.params.session_name + '#' + job.params.id).green;
}

function board_str(board) 
{
    return board.hostname.yellow;
}

function session_str(session) 
{
    return (session.params.name + '#' + session.params.id).brightBlue;
}

function docker_str(container_id) 
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
    const pmsg = (msg);
    return pmsg.bold;
}


module.exports.LOG_USER = user_str;
module.exports.LOG_JOB = job_str;
module.exports.LOG_BOARD = board_str;
module.exports.LOG_SESSION = session_str;
module.exports.LOG_TIME = time_str;
module.exports.LOG_CONTAINER = docker_str;
module.exports.LOG_IMAGE = docker_str;
module.exports.ERROR = error_str;

