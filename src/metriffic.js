const Board   = require('./ms_board').Board;
const Grid = require('./ms_grid').Grid;
const metriffic_client = require('./metriffic_gql').metriffic_client
const gql = require('graphql-tag');
const ERROR = require('./logging').ERROR
const config = require('./config')

class Metriffic 
{       
    constructor() 
    {
        this.grids = {};
        this.start();
    }

    async start()
    {
        console.log('[M] starting service...');
        await this.start_platform_grids();
        await this.subscribe_to_gql_updates();
        await this.add_existing_sessions();
    }

    on_board_added(data)
    {
        // TBD
    }

    on_board_removed(data)
    {
        // TBD
    }

    on_session_added(input_data)
    {        
        const grid = this.grids[input_data.platform_id];
        const command = JSON.parse(input_data.command);
        const datasets = JSON.parse(input_data.datasets);
        const data = {
            id: input_data.session_id,
            name: input_data.session_name,
            type: input_data.session_type,
            docker_image: input_data.docker_image,
            docker_options: input_data.docker_options ? JSON.parse(input_data.docker_options) : {},
            docker_registry: config.DOCKER_REGISTRY_HOST,
            user: input_data.user,
            command: command,
            datasets: datasets,
            max_jobs: input_data.max_jobs,
        };
        grid.submit_session(data);
    }

    on_session_removed(data)
    {
        const grid = this.grids[data.platform_id];
        const session = grid.get_session(data.session_id);
        if(session) {
            grid.dismiss_session(session);
        }
    }

    on_session_save(data)
    {
        const grid = this.grids[data.platform_id];
        const session = grid.get_session(data.session_id);
        
        const docker_image = data.docker_image;        
        if(session) {
            grid.save_session(session, docker_image);
        }
    }

    async subscribe_to_gql_updates()
    {
        const metriffic = this;

        const subscribe_boards = gql`
        subscription subsBoard { 
            subsBoard { mutation data {hostname platform {id name}}}
        }`;
            
        // subscribe to board updates
        metriffic_client.gql.subscribe({
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
            subsSession { mutation data }
        }`;

        metriffic_client.gql.subscribe({
            query: subscribe_sessions,
        }).subscribe({
            next(ret) {
                const update = ret.data.subsSession
                const update_data = JSON.parse(update.data);
                if(update.mutation === "ADDED") {
                    metriffic.on_session_added(update_data);
                } else
                if(update.mutation === "UPDATED") {
                    if(update_data.session_state === "CANCELED") {
                        metriffic.on_session_removed(update_data);
                    }
                    // TBD: handle other state transitions...
                } else 
                if(update.mutation === "REQUESTED_SAVE") {
                    metriffic.on_session_save(update_data);
                } else {
                    console.log(ERROR(`[M] error: received unknown session subscription data: ${update}`));
                }
            },
            error(err) {
                console.log('ERROR: failes to subscribe', err);
            }
        });
    }

    async start_platform_grids()
    {
        const metriffic = this; 

        const all_platforms_gql = gql`{ 
                allPlatforms { id name description } 
            }`;

        // a query with apollo-client
        const all_platforms = await metriffic_client.gql.query({
                                        query: all_platforms_gql
                                    });

        const promises = all_platforms.data.allPlatforms.map(function(platform) {
            console.log(`[M] Building grid-manager for platform[${platform.name}]`);
            // create a new grid for the platform
            metriffic.grids[platform.id] = new Grid(platform);
            // pull boards for this platform
            const all_boards_gql = gql`
                    query allBoards($platformName: String) {
                        allBoards (platformName: $platformName) 
                        {id hostname description}
                    }`;
            metriffic_client.gql.query({
                            query: all_boards_gql,
                            variables: {platformName: platform.name},
                        })
            .then(function(all_boards) {
                all_boards.data.allBoards.forEach(board => {
                        metriffic.grids[platform.id].register_board(new Board({
                                platform: platform.name, 
                                hostname: board.hostname
                            }));
                    });    
                metriffic.grids[platform.id].start();
            });
        });
        await Promise.all(promises);
    }

    async add_existing_sessions() 
    {
        const metriffic = this;
        const all_sessions_gql = gql`
            query{ allSessions(platformName: "" status: "SUBMITTED") 
              { id name type user{username} max_jobs datasets command platform{id} dockerImage{name}} 
            }`;
            
        const all_sessions = await metriffic_client.gql.query({
                                query: all_sessions_gql,
                            });
        all_sessions.data.allSessions.forEach(session => {
                            if(session.state === "SUBMITTED") {
                                metriffic.on_session_added(session);
                            }
                            // TBD: handle other states
                        });
        
    }

};

   

module.exports.Metriffic = Metriffic;
