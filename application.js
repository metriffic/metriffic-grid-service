const Metriffic = require('./src/metriffic').Metriffic;

const HOSTNAME = "localhost";
const PORT = 4000;

const mparams = {
    WS_ENDPOINT:  "ws://" + HOSTNAME + ":" + PORT + "/graphql",
};
console.log('Started the server is on ', mparams.WS_ENDPOINT);
const metriffic = new Metriffic(mparams);

  
