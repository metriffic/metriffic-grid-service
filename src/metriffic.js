const gql = require('graphql-tag');
const ping = require('ping')
const Board   = require('./ms_board').Board;
const Grid = require('./ms_grid').Grid;
const metriffic_client = require('./metriffic_gql').metriffic_client
const config = require('./config')
const { ERROR } = require('./logging')
const { publish_to_user_stream } = require('./data_stream');


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
        const unfinished_sessions = await this.request_unfinished_sessions();
        await this.start_platform_grids(unfinished_sessions);
        await this.subscribe_to_gql_updates();
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
        const data = {
            id: input_data.session_id,
            name: input_data.session_name,
            type: input_data.session_type,
            platform_id: input_data.platform_id,
            docker_image: input_data.docker_image,
            docker_options: input_data.docker_options ? JSON.parse(input_data.docker_options) : {},
            docker_registry: config.DOCKER_REGISTRY_HOST,
            username: input_data.username,
            user_id: input_data.user_id,
            user_key: input_data.user_key,
            command: command,
            dataset_split: input_data.dataset_split,
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
        } else {
            console.log(`[M] failed to save the image for session ${data.session_name}, session doesn't exist...`);
            publish_to_user_stream(data.username, {
                type: 'commit_error',
                error: 'session is not available (terminated?)',
            });
        }
    }

    collect_platform_diagnostics()
    {
        const platform_data = [];
        const promises = [];
        for(let g in this.grids) {
            const grid = this.grids[g];
            const one_platform = {
                name: grid.name,
                boards: [],
            };
            grid.boards.forEach(async (board) => {

                promises.push(new Promise((resolve, reject) => {
                    ping.promise.probe(board.hostname).then(function (res) {
                        one_platform.boards.push({
                            hostname: board.hostname,
                            used: board.used,
                            alive: res.alive,
                            ping: res.avg,
                        });
                        resolve();
                    });
                }));

            });
            platform_data.push(one_platform);
        };
        return Promise.all(promises).then(() => {
            return platform_data;
        });
    }

    collect_session_diagnostics()
    {
        const session_data = [];
        for(let g in this.grids) {
            const grid = this.grids[g];
            const one_platform = {
                name: grid.name,
                sessions: [],
                running_jobs: [],
            };
            grid.running_jobs.forEach((rj) => {
                one_platform.running_jobs.push({
                    session: rj.params.session_name,
                    name: rj.params.dataset + '#' + rj.params.id,
                    type: rj.params.type,
                    start: new Date(rj.start_timestamp).toLocaleString(),
                    container: rj.container.id.substring(0,10),
                    board: rj.board.hostname,
                })
            })
            grid.subscribers.forEach((ss) => {
                one_platform.sessions.push({
                    name: ss.params.name,
                    user: ss.params.username,
                    total_jobs: ss.total_jobs,
                    remaining_jobs: ss.submitted.length,
                    running_jobs: ss.running.length,
                });
            })
            session_data.push(one_platform);
        };
        return session_data;
    }

    async on_admin_command(update)
    {
        if(update.command == 'DIAGNOSTICS') {
            update.data = {};
            const platform_data = await this.collect_platform_diagnostics();
            const session_data = this.collect_session_diagnostics();
            update.data['platforms'] = platform_data;
            update.data['sessions'] = session_data;
            publish_to_user_stream(update.username, update.data);
        }
    }

    async subscribe_to_gql_updates()
    {
        const metriffic = this;

        const subscribe_boards = gql`
        subscription subsBoard {
            subsBoard { mutation data {hostname ip platform {id name}}}
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
                console.log('ERROR: failed to subscribe', err);
            }
        });

        // subscribe to session updates
        const subscribe_admin = gql`
        subscription subsAdmin {
            subsAdmin { username command data }
        }`;

        metriffic_client.gql.subscribe({
            query: subscribe_admin,
        }).subscribe({
            next(ret) {
                const update = ret.data.subsAdmin
                if(update.command === "DIAGNOSTICS") {
                    metriffic.on_admin_command(update);

                } else {
                    console.log(ERROR(`[M] error: received unknown admin command: ${update}`));
                }
            },
            error(err) {
                console.log('ERROR: failed to subscribe', err);
            }
        });

        // subscribe to user updates
        const subscribe_heartbeat = gql`
        subscription hearBeat {
            subsHeartBeat { beat_num }
        }`;

        metriffic_client.gql.subscribe({
            query: subscribe_heartbeat,
        }).subscribe({
            next(ret) {
                const update = ret.data.subsHeartBeat;
                console.log(`[WM] heartbeat#${update['beat_num']} received at ${new Date()}`);
            },
            error(err) {
                console.log(ERROR(`[WM] error: failed to subscribe: ${err}`));
            }
        });
    }

    async start_platform_grids(unfinished_sessions)
    {
        const metriffic = this;

        const all_platforms_gql = gql`{
                allPlatforms { id name description }
            }`;

        // a query with apollo-client
        const all_platforms = await metriffic_client.gql.query({
                                        query: all_platforms_gql
                                    });

        const promises = all_platforms.data.allPlatforms.map(async (platform) => {
            console.log(`[M] Building grid-manager for platform[${platform.name}]`);
            // create a new grid for the platform
            const grid = new Grid(platform);
            metriffic.grids[platform.id] = grid;
            // pull boards for this platform
            const all_boards_gql = gql`
                    query allBoards($platformName: String) {
                        allBoards (platformName: $platformName)
                        {id hostname ip description}
                    }`;
            const all_boards = await metriffic_client.gql.query({
                            query: all_boards_gql,
                            variables: {platformName: platform.name},
                        })
            all_boards.data.allBoards.forEach(board => {
                        grid.register_board(new Board({
                                platform: platform.name,
                                hostname: board.hostname,
                                ip: board.ip
                            }));
                    });
            //console.log('UFS', platform.id, unfinished_sessions.get(platform.id))
            metriffic.grids[platform.id].start(unfinished_sessions.get(platform.id));
        });
        await Promise.all(promises);
    }

    async request_unfinished_sessions()
    {
        const metriffic = this;
        const all_sessions_gql = gql`
            query all_sessions($platformName: String, $state: [String]) {
              allSessions(platformName: $platformName, state: $state)
              { id name type state user{username id userKey} maxJobs datasetSplit command platform{id} dockerImage{name options}}
            }`;

        const all_sessions = await metriffic_client.gql.query({
                                query: all_sessions_gql,
                                variables: { platformName: null,
                                             state: ['SUBMITTED','RUNNING'] }
                            });
        //console.log('EXISTING', JSON.stringify(all_sessions, undefined, 4))
        const unfinished_sessions = new Map();
        all_sessions.data.allSessions.forEach(session => {
                            console.log('EEEEEE', session.platform)
                            const uf_session = {
                                    username: session.user.username,
                                    user_id: session.user.id,
                                    user_key: session.user.userKey,
                                    session_id: session.id,
                                    session_name : session.name,
                                    session_type: session.type,
                                    platform_id: session.platform.id,
                                    docker_image: session.dockerImage.name,
                                    docker_options: session.dockerImage.options,
                                    command: session.command,
                                    dataset_split: session.datasetSplit,
                                    max_jobs: session.maxJobs,
                                    state: session.state,
                                };
                            if(unfinished_sessions.has(uf_session.platform_id))
                                unfinished_sessions.get(uf_session.platform_id).push(uf_session);
                            else
                                unfinished_sessions.set(uf_session.platform_id, [uf_session]);
                        }
        );
        console.log('UNFINISHED SESSIONS', unfinished_sessions);
        return unfinished_sessions;
    }

    // async update_session(session_name, session_state) {
    //     try {
    //         const mutation_running_session = gql`
    //         mutation running_session($name: String!, $state: String!) {
    //             sessionUpdateState(name: $name, state: $state)
    //             { id }
    //         }`;
    //         const session_update = await metriffic_client.gql.mutate({
    //                         mutation: mutation_running_session,
    //                         variables: { name: session.params.name,
    //                                     state: state }
    //                     });
    //     // nothing
    //     } catch(err) {
    //         console.log(ERROR(`[S] failed to update BE with 'running session' request [${LOG_SESSION(session)}]: ${err}.`));
    //     }
    // }
};



module.exports.Metriffic = Metriffic;
