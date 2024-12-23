const config = require('./config')
const gql = require('graphql-tag');
const fs   = require('fs');
const jwt   = require('jsonwebtoken');

const WebSocket = require('ws');
const { ApolloClient } = require("apollo-client");
const { InMemoryCache } = require("apollo-cache-inmemory");
const { WebSocketLink } = require('apollo-link-ws');
const { SubscriptionClient } = require("subscriptions-transport-ws");
const {
    LOG_JOB,
    LOG_SESSION,
    ERROR
 } = require('./logging')

class MetrifficGQL
{       
    constructor() 
    {
        var options = {
            algorithm:  "RS256"    
        };
        const grid_manager_private_key  = fs.readFileSync(config.GRID_SERVICE_PRIVATE_KEY_FILE, 'utf8');
        const token = jwt.sign({who: config.GQL_ENDPOINT}, grid_manager_private_key, options);
        
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

    async update_job_gql(job_id, state) {
        console.log(`[GQL] updating job [${job_id}] to state [${state}]`);
        try {
            // update the BE
            const mutation_job = gql`
            mutation update_job($jobId: Int!, $state: String!) {
                jobUpdate(id: $jobId, state: $state)
                { id }
            }`;
            const job_update = await this.gql.mutate({
                        mutation: mutation_job,
                        variables: { jobId: job_id,
                                     state: state }
                    })
        } catch(err) {
            console.log(ERROR(`[GQL] failed to update BE job [${LOG_JOB(job)}] to state '${state}': ${err}.`));
        }
    }

    async update_session_gql(session_name, state) {
        console.log(`[GQL] updating session [${session_name}] to state [${state}]`);
        try {
            const mutation_session = gql`
            mutation update_session($name: String!, $state: String!) {
                sessionUpdateState(name: $name, state: $state)
                { id }
            }`;
            const session_stop = await this.gql.mutate({
                mutation: mutation_session,
                variables: { name: session_name,
                             state: state }
            })
            // nothing
        } catch(err) {
            console.log(ERROR(`[GQL] failed to update BE session [${LOG_SESSION(session)}] to state '${session_state}': ${err}.`));
        }
    }

    async get_jobs_gql(session_id) {
        console.log(`[GQL] getting jobs for [${session_id}]`);
        try {
            // update the BE
            const query_job = gql`
            query jobs_get($sessionId: Int!) {
                jobsGet(sessionId: $sessionId)
                { id, datasetChunk, session {id}, state }
            }`;
            const jobs_get = await this.gql.query({
                        query: query_job,
                        variables: { sessionId: session_id }
                    });
            console.log(`[GQL] session[${session_id}] jobs: ${JSON.stringify(jobs_get, null, 4)}`);
            return jobs_get?.data?.jobsGet;
        } catch(err) {
            console.log(ERROR(`[GQL] failed to get BE jobs for session [${session_id}], ${err}.`));
        }
    }
};

   

module.exports.metriffic_client = new MetrifficGQL();
