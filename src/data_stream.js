const metriffic_client = require('./metriffic_gql').metriffic_client
const gql = require('graphql-tag');

module.exports.publish_to_user_stream = (user, data) => {

    console.log('PUBLISHING', user, data);


    const mutation_publish_data = gql`
    mutation ms($username: String!, $data: String!) { 
        publishData(username: $username, data: $data) 
    }`;
    metriffic_client.gql.mutate({
        mutation: mutation_publish_data,
        variables: { username: user, 
                     data: JSON.stringify(data) }
    }).then(function(ret) {
        console.log('PUBLISHED', ret.data);
    }).catch(function(err){
        console.log('ERROR in publishing data', err);
    });
};

