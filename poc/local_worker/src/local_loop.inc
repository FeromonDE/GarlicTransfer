#include <ctype.h>
#include <sys/socket.h>
#include <sys/time.h>

// Function Job Checking
static int local_job_id(const char *id) {
    if (strlen(id) != 36) return 0;
    for (size_t i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (id[i] != '-') return 0;
        } else if (!isxdigit((unsigned char)id[i])) return 0;
    }
    return 1;
}

// Function Local Jobs
void worker_loop_local(int listener) {
    worker_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.connection_mode = 1;
    g_transport_mode = 1;
    for (;;) {
        tcp_conn_t connection;
        connection.sock = accept(listener, NULL, NULL);
        if (connection.sock < 0) continue;
        connection.connected = 1;
        struct timeval timeout = {120, 0};
        setsockopt(connection.sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        setsockopt(connection.sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
        g_tcp = &connection;
        char request[8192], type[32] = {0}, id[64] = {0}, operation[32] = {0};
        char params[8192] = {0};
        if (tcp_send_msg(&connection,
                "{\"type\":\"hello\",\"protocol\":\"garlic-local-v1\",\"platform\":\"ps5\"}") < 0 ||
            tcp_recv_msg(&connection, request, sizeof(request)) < 0) {
            tcp_disconnect(&connection); g_tcp = NULL; continue;
        }
        json_get_string(request, "type", type, sizeof(type));
        json_get_string(request, "id", id, sizeof(id));
        json_get_string(request, "operation", operation, sizeof(operation));
        json_get_object(request, "params", params, sizeof(params));
        if (strcmp(type, "job") || !local_job_id(id)) {
            tcp_disconnect(&connection); g_tcp = NULL; continue;
        }
        int valid_operation = !strcmp(operation, "decrypt") || !strcmp(operation, "encrypt") ||
                              !strcmp(operation, "resign");
        if (!valid_operation) {
            worker_set_status(&cfg, id, "failed", "Unsupported local save operation");
            tcp_disconnect(&connection); g_tcp = NULL; continue;
        }
        if (strcmp(operation, "decrypt")) {
            char account[64] = {0};
            json_get_string(params, "account_id", account, sizeof(account));
            int valid_account = strlen(account) == 16;
            for (size_t i = 0; account[i]; i++)
                if (!isxdigit((unsigned char)account[i])) valid_account = 0;
            if (!valid_account) {
                worker_set_status(&cfg, id, "failed", "A 16-digit hexadecimal account ID is required");
                tcp_disconnect(&connection); g_tcp = NULL; continue;
            }
        }
        char work_dir[MAX_PATH_LEN];
        snprintf(work_dir, sizeof(work_dir), "/data/garlic/local-work/%s-XXXXXX", id);
        if (!mkdtemp(work_dir)) {
            worker_set_status(&cfg, id, "failed", "Could not create local job folder");
            tcp_disconnect(&connection); g_tcp = NULL; continue;
        }
        pthread_mutex_lock(&local_operation_mutex);
        local_credentials_t saved;
        local_credentials_save(&saved);
        g_last_error[0] = 0;
        g_last_error[0] = 0;
        worker_set_status(&cfg, id, "running", NULL);
        int result;
        if (!strcmp(operation, "decrypt")) result = process_decrypt(&cfg, id, params, work_dir);
        else if (!strcmp(operation, "encrypt")) result = process_encrypt(&cfg, id, params, work_dir, 0);
        else result = process_resign(&cfg, id, params, work_dir, 0);
        if (save_is_mounted()) save_unmount();
        local_credentials_restore(&saved);
        pthread_mutex_unlock(&local_operation_mutex);
        if (result == 0) worker_set_status(&cfg, id, "done", NULL);
        else worker_set_status(&cfg, id, "failed",
                g_last_error[0] ? g_last_error : "Local save operation failed");
        tcp_disconnect(&connection);
        g_tcp = NULL;
        delete_recursive(work_dir);
    }
}
