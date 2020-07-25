const config = require('./config')

const fs   = require('fs');
const jwt   = require('jsonwebtoken');

const WebSocket = require('ws');
const { ApolloClient } = require("apollo-client");
const { InMemoryCache } = require("apollo-cache-inmemory");
const { WebSocketLink } = require('apollo-link-ws');
const { SubscriptionClient } = require("subscriptions-transport-ws");

class MetrifficGQL
{       
    constructor() 
    {
        var options = {
            algorithm:  "RS256"    
        };
        const grid_manager_private_key  = fs.readFileSync(config.GRID_SERVICE_PRIVATE_KEY_FILE, 'utf8');
        const token = jwt.sign({who: "grid_service"}, grid_manager_private_key, options);
        
        const WS_ENDPOINT = config.GQL_ADDRESS;
        console.log('[MC] initializing metriffic client to ', WS_ENDPOINT);

        const wsClient = new SubscriptionClient(
            WS_ENDPOINT,
            {
                reconnect: true,
                //connectionParams: () => { 
                //    return { FOO: "FOO"}; 
                //  },
            },
            WebSocket
        )
        const link = new WebSocketLink(wsClient)

        // https://github.com/apollographql/apollo-link/issues/446
        const subscriptionMiddleware = {
            applyMiddleware: function(payload, next) {
              // set it on the `payload` which will be passed to the websocket with Apollo 
              // Server it becomes: `ApolloServer({contetx: ({payload}) => (returns options)
              payload.authorization = 'Bearer ' + token;
              payload.endpoint = config.GQL_ENDPOINT;
              next()
            },
          };
        link.subscriptionClient.use([subscriptionMiddleware]);

        const cache =  new InMemoryCache({});

        this.gql = new ApolloClient({
            link,
            cache,
        })
    }
};

   

module.exports.metriffic_client = new MetrifficGQL();
