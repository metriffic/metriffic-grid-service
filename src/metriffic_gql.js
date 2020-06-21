const config = require('./config')

const fs   = require('fs');
const jwt   = require('jsonwebtoken');

import WebSocket from 'ws';
import ApolloClient from "apollo-client";
import { InMemoryCache } from "apollo-cache-inmemory";
import { WebSocketLink } from 'apollo-link-ws';
import { SubscriptionClient } from "subscriptions-transport-ws";
import gql from 'graphql-tag';

// use 'utf8' to get string instead of byte array  (512 bit key)



class MetrifficGQL
{       
    constructor() 
    {
        var options = {
            algorithm:  "RS256"    
        };
        const grid_manager_private_key  = fs.readFileSync('./grid_service_private.key', 'utf8');
        const token = jwt.sign({who: "grid_service"}, grid_manager_private_key, options);
        
        const WS_ENDPOINT = "ws://" + config.GQL_HOSTNAME + ":" + config.GQL_PORT + "/graphql";
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
              payload.endpoint = "grid_service";
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