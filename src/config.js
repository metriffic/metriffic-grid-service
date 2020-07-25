const path   = require('path');

module.exports = {
    GQL_HOSTNAME: process.env['METRIFFIC_GQL_HOSTNAME'],
    GQL_PORT: process.env['METRIFFIC_GQL_PORT'],

    GQL_ENDPOINT: "grid_service",
    
    SSH_PORT_HOST_MIN: process.env['METRIFFIC_SSH_PORT_HOST_MIN'],
    SSH_PORT_HOST_MAX: process.env['METRIFFIC_SSH_PORT_HOST_MAX'],

    // TBD: this is the copy of the const stored in metriffic-workspaces service...
    USERSPACE_DIR_ROOT : process.env['METRIFFIC_USERSPACE_NFS_ROOT'],
    USERSPACE_HOST : process.env['METRIFFIC_USERSPACE_NFS_HOST'],

    GRID_SERVICE_PRIVATE_KEY_FILE: process.env['METRIFFIC_GRID_SERVICE_PRIVATE_KEY_FILE'],
}
  