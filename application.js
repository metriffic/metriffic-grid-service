const Metriffic = require('./src/metriffic').Metriffic;

const HOSTNAME = "localhost";
const PORT = 4000;

const mparams = {
    WS_ENDPOINT:  "ws://" + HOSTNAME + ":" + PORT + "/graphql",
};
const metriffic = new Metriffic(mparams);

  
