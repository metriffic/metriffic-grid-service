const Job     = require('./ms_job').Job;
const Board   = require('./ms_board').Board;
const Grid = require('./ms_grid').Grid;
import WebSocket from 'ws';
import ApolloClient from "apollo-client";
import { InMemoryCache } from "apollo-cache-inmemory";
import { WebSocketLink } from 'apollo-link-ws';
import gql from 'graphql-tag';

import { SubscriptionClient } from "subscriptions-transport-ws";

class Metriffic 
{       
    constructor(params) 
    {
        this.grids = {};

        const wsClient = new SubscriptionClient(
            params.WS_ENDPOINT,
            { reconnect: true },
            WebSocket
        )
        const link = new WebSocketLink(wsClient)
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
        console.log('SUBSCRIPTION: ', data.boardAdded);
    }

    on_session_added(data)
    {
        console.log('SUBSCRIPTION: ', data);
        
        const grid = this.grids[data.platform.id];
        const command = JSON.parse(data.command);
        const datasets = JSON.parse(data.datasets)
        data.server_docker = 'ubuntu-provider-collector';
        data.docker_registry = "192.168.86.244:5000";
        data.user = 'vazkus';
        data.project = 'test-project';
        data.session_name = data.name;
        data.command = command;
        data.datasets = datasets,
        grid.submit_session(data);
    }


    subscribe_to_gql_updates()
    {
        const metriffic = this;

        const subscribe_boards = gql`
        subscription boardAdded{ 
            boardAdded { hostname platform{id}}
        }`;
            
        // subscribe to board updates
        this.gql_client.subscribe({
            query: subscribe_boards,
        }).subscribe({
            next(ret) {
                metriffic.on_board_added(ret.data);
            },
            error(err) {
                console.log('ERROR: failed to subscribe', err);
            }
        })

        // subscribe to session updates
        const subscribe_sessions = gql`
        subscription sessionAdded{ 
            sessionAdded { id, name, platform{id}, max_jobs, datasets, command }        
        }`;
        this.gql_client.subscribe({
            query: subscribe_sessions,
        }).subscribe({
            next(ret) {
                metriffic.on_session_added(ret.data.sessionAdded);
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
              { id name max_jobs datasets command platform{id} dockerImage{id}} 
            }`;
            
        this.gql_client.query({
            query: query_platform,
        }).then(function(ret) {
            console.log('NEXT', ret.data);
            ret.data.allSessions.forEach(params => {
                metriffic.on_session_added(params)
            });
        }).catch(function(err){
            console.log('ERROR', err);
        });
    }

};

   

module.exports.Metriffic = Metriffic;
