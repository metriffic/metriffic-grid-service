const Job     = require('./ms_job').Job;
const Board   = require('./ms_board').Board;
const Grid = require('./ms_grid').Grid;
const ERROR = require('./ms_logging').ERROR

const fs   = require('fs');
const jwt   = require('jsonwebtoken');

import WebSocket from 'ws';
import ApolloClient from "apollo-client";
import { InMemoryCache } from "apollo-cache-inmemory";
import { WebSocketLink } from 'apollo-link-ws';
import { SubscriptionClient } from "subscriptions-transport-ws";
import gql from 'graphql-tag';

// use 'utf8' to get string instead of byte array  (512 bit key)



class Metriffic 
{       
    constructor(params) 
    {
        var options = {
            algorithm:  "RS256"    
        };
        const grid_manager_private_key  = fs.readFileSync('./grid_service_private.key', 'utf8');
        const token = jwt.sign({who: "grid_service"}, grid_manager_private_key, options);
        
        this.grids = {};

        const wsClient = new SubscriptionClient(
            params.WS_ENDPOINT,
            {
                reconnect: true,
                connectionParams: () => { 
                    return { FOO: "FOO"}; 
                  },
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

        this.gql_client = new ApolloClient({
            link,
            cache,
        })
        
        this.start_platform_grids();
        this.subscribe_to_gql_updates();
        this.add_existing_sessions();
    }

    on_board_added(data)
    {
        console.log('BOARDADDED: ', data.boardAdded);
    }

    on_board_removed(data)
    {
        // TBD
    }

    on_session_added(data)
    {        
        const grid = this.grids[data.platform.id];
        const command = JSON.parse(data.command);
        const datasets = JSON.parse(data.datasets)
        data.docker_image = data.dockerImage.name;
        data.server_docker_image = 'ubuntu-provider-collector';
        data.docker_registry = "192.168.86.244:5000";
        data.user = data.user.username;
        data.project = 'test-project';
        data.session_name = data.name;
        data.command = command;
        data.datasets = datasets,
        grid.submit_session(data);
    }

    on_session_removed(data)
    {
        // TBD
    }

    subscribe_to_gql_updates()
    {
        const metriffic = this;

        const subscribe_boards = gql`
        subscription subsBoard { 
            subsBoard { mutation data {hostname platform {id name}}}
        }`;
            
        // subscribe to board updates
        this.gql_client.subscribe({
            query: subscribe_boards,
        }).subscribe({
            next(ret) {
                const update = ret.data.subsBoard;
                if(update.mutation === "ADDED") {
                    metriffic.on_board_added(update.data);
                } else
                if(update.mutation === "REMOVED") {
                    // TBD
                    //metriffic.on_board_removed(ret.data);
                } else {
                    console.log(ERROR(`[M] error: received unknown board subscription data: ${update}`));
                }
            },
            error(err) {
                console.log('ERROR: failed to subscribe', err);
            }
        })

        // subscribe to session updates
        const subscribe_sessions = gql`
        subscription subsSession { 
            subsSession { mutation data {id, name, type, user{username}, platform{id}, dockerImage{name} max_jobs, datasets, command }}
        }`;
        this.gql_client.subscribe({
            query: subscribe_sessions,
        }).subscribe({
            next(ret) {
                const update = ret.data.subsSession;            
                if(update.mutation === "ADDED") {
                    metriffic.on_session_added(update.data);
                } else
                if(update.mutation === "REMOVED") {
                    // TBD
                    //metriffic.on_session_removed(ret.data);
                } else {
                    console.log(ERROR(`[M] error: received unknown board subscription data: ${data}`));
                }
            },
            error(err) {
                console.log('ERROR: failes to subscribe', err);
            }
        })
    }

    async start_platform_grids()
    {
        const get_platforms = gql`{ 
                allPlatforms { id name description } 
            }`;
        const metriffic = this; 

        // a query with apollo-client
        this.gql_client.query({
          query: get_platforms
        }).then(function(ret) {
            ret.data.allPlatforms.forEach(platform => {
                console.log(`Building grid-manager for platform[${platform.name}]`);
                // create a new grid for the platform
                metriffic.grids[platform.id] = new Grid(platform);
                // pull boards for this platform
                const get_boards = gql`
                        query allBoards($platformId: Int!) {
                            allBoards (platformId: $platformId) 
                            {id hostname description}
                        }`;
                metriffic.gql_client.query({
                    query: get_boards,
                    variables: {platformId: platform.id},
                }).then(function(ret) {
                    ret.data.allBoards.forEach(board => {
                            metriffic.grids[platform.id].register_board(new Board({
                                    platform: platform.name, 
                                    hostname: board.hostname
                                }));
                        });    
                    metriffic.grids[platform.id].start();
                });
            });
        });
    }

    async add_existing_sessions() 
    {
        const metriffic = this;
        const query_platform = gql`
            query{ allSessions(platformId:-1) 
              { id name type user{username} max_jobs datasets command platform{id} dockerImage{name}} 
            }`;
            
        this.gql_client.query({
            query: query_platform,
        }).then(function(ret) {
            ret.data.allSessions.forEach(params => {
                metriffic.on_session_added(params)
            });
        }).catch(function(err){
            console.log('ERROR', err);
        });
    }

};

   

module.exports.Metriffic = Metriffic;
