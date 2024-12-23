import ApolloClient from 'apollo-client';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { WebSocketLink } from 'apollo-link-ws';
import WebSocket from 'ws';
import gql from 'graphql-tag';

import { SubscriptionClient } from "subscriptions-transport-ws";

const HOSTNAME = "localhost";
const PORT = 4000;

const params = {
    WS_ENDPOINT:  "ws://" + HOSTNAME + ":" + PORT + "/graphql",
};
  
const wsClient = new SubscriptionClient(
    params.WS_ENDPOINT,
    { reconnect: true },
    WebSocket
)
const link = new WebSocketLink(wsClient)
const cache =  new InMemoryCache({});
const gql_client = new ApolloClient({
    link,
    cache,
})

function create_platform()
{
    const mutation_create_platform = gql`
    mutation{ createPlatform(name:"RPi3B", description:"RAM:1Gb") 
      { id, name, description } 
    }`;

    gql_client.mutate({
        mutation: mutation_create_platform,
    }).then(function(ret) {
        console.log('CREATED', ret.data);
    }).catch(function(err){
        console.log('ERROR in platform creation', err);
    });
}

function create_board(hostname)
{
    const mutation_create_board = gql`
    mutation 
        mb($hn: String!) {
            createBoard(platformId: 1, hostname: $hn, description:"") 
            { id, hostname, description } 
        }`;

    gql_client.mutate({
        mutation: mutation_create_board,
        variables: { hn: hostname }
    }).then(function(ret) {
        console.log('CREATED', ret.data);
    }).catch(function(err){
        console.log('ERROR in board creation', err);
    });
}

function create_docker_image()
{
    const mutation_create_dockerimage = gql`
    mutation{ createDockerImage(platformId:1, name:"ubuntu-run", description:"") 
      { id name, description, platform {id} } 
    }`;
    gql_client.mutate({
        mutation: mutation_create_dockerimage,
    }).then(function(ret) {
        console.log('CREATED', ret.data);
    }).catch(function(err){
        console.log('ERROR in docker image creation', err);
    });
}

function create_session()
{
    const commands = ["/bin/bash", "-c", "export"];
    //const datasets_str = "\"" + JSON.stringify(datasets) + "\"";
    //const command_str = "\"" + JSON.stringify(commands) + "\"";
    const datasetSplit = 2;
    const command_str = JSON.stringify(commands);


    const mutation_create_session = gql`
    mutation ms($datasets: String!, $command: String!) { 
        createSession(name:"test-session", datasetSplit: $datasetSplit, maxJobs: 1, 
                      command: $command, platformId:1, dockerImageId: 1) 
        { id name datasets maxJobs command platform{id} dockerImage{id}} 
    }`;
    gql_client.mutate({
        mutation: mutation_create_session,
        variables: { datasetSplit: datasetSplit, 
                     command: command_str }
    }).then(function(ret) {
        console.log('CREATED', ret.data);

        const mutation_create_job = gql`
        mutation mj($sessionId: Int!, $ds: String!) { 
            createJob(sessionId:$sessionId, dataset: $ds) 
          { id dataset} 
        }`;
        datasets.forEach(ds => {
            gql_client.mutate({
                mutation: mutation_create_job,
                variables: {sessionId: ret.data.createSession.id,
                            ds: ds}
            }).then(function(ret) {
                console.log('CREATED job', ret.data);
            });
        });
    }).catch(function(err){
        console.log('ERROR in session creation', err);
    });
}

create_platform();
create_docker_image();
create_board("metriffic-rpi3-1");
create_board("metriffic-rpi3-2");
create_board("metriffic-rpi3-3");
create_session();
