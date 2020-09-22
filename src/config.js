const path   = require('path');
const env = require('env-var');

module.exports = {
    GQL_ADDRESS: env.get('METRIFFIC_GQL_ADDRESS').required().asString(),

    GQL_ENDPOINT: "grid_service",

    SSH_PORT_HOST_MIN: env.get('METRIFFIC_SSH_PORT_HOST_MIN').required().asIntPositive(),
    SSH_PORT_HOST_MAX: env.get('METRIFFIC_SSH_PORT_HOST_MAX').required().asIntPositive(),

    // TBD: this is the copy of the const stored in metriffic-workspaces service...
    USERSPACE_DIR_ROOT : env.get('METRIFFIC_USERSPACE_NFS_ROOT').required().asString(),
    NFS_HOST : env.get('METRIFFIC_NFS_HOST').required().asString(),
    USERSPACE_NFS_DIR_ROOT : env.get('METRIFFIC_USERSPACE_NFS_ROOT').required().asString(),
    PUBLICSPACE_NFS_DIR_ROOT : env.get('METRIFFIC_PUBLICSPACE_NFS_ROOT').required().asString(),
    USERSPACE_DIR_ROOT : env.get('METRIFFIC_USERSPACE_ROOT').required().asString(),


    DOCKER_REGISTRY_HOST : env.get('METRIFFIC_DOCKER_REGISTRY_HOST').required().asString(),
    DOCKER_REGISTRY_USERNAME: env.get('METRIFFIC_DOCKER_REGISTRY_USERNAME').required().asString(),
    DOCKER_REGISTRY_PASSWORD: env.get('METRIFFIC_DOCKER_REGISTRY_PASSWORD').required().asString(),

    GRID_SERVICE_PRIVATE_KEY_FILE: env.get('METRIFFIC_GRID_SERVICE_PRIVATE_KEY_FILE').required().asString(),
}
