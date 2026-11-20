#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <dirent.h>
#include <sys/stat.h>
#include <stdint.h>
#include <errno.h>

#include "zip.h"
#include "util.h"
#include "log.h"

/* ── CRC32 ─────────────────────────────────────────────────────── */
static uint32_t crc_tab[256];

void zip_init_crc(void) {
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int j = 0; j < 8; j++) c = (c >> 1) ^ (c & 1 ? 0xEDB88320 : 0);
        crc_tab[i] = c;
    }
}

/* ── ZIP extract (from file, streaming) ────────────────────────── */
int zip_extract_file(const char *zip_path, const char *dest_dir) {
    int zfd = open(zip_path, O_RDONLY);
    if (zfd < 0) {
        garlic_log("[Garlic] zip_extract: cannot open %s\n", zip_path);
        return -1;
    }

    struct stat zst;
    fstat(zfd, &zst);
    size_t file_size = zst.st_size;
    garlic_log("[Garlic] zip_extract: %s (%zu bytes)\n", zip_path, file_size);

    int count = 0;
    uint8_t hdr[30];

    while (1) {
        /* Read local file header */
        ssize_t n = read(zfd, hdr, 30);
        if (n < 30) break;
        if (hdr[0] != 0x50 || hdr[1] != 0x4b || hdr[2] != 0x03 || hdr[3] != 0x04) break;

        uint16_t compression = 0, name_len = 0, extra_len = 0;
        uint32_t comp_size = 0, uncomp_size = 0;
        memcpy(&compression, hdr + 8, 2);
        memcpy(&comp_size, hdr + 18, 4);
        memcpy(&uncomp_size, hdr + 22, 4);
        memcpy(&name_len, hdr + 26, 2);
        memcpy(&extra_len, hdr + 28, 2);

        char name[MAX_PATH_LEN] = {0};
        uint16_t copy_len = name_len < MAX_PATH_LEN - 1 ? name_len : (uint16_t)(MAX_PATH_LEN - 1);
        if (read(zfd, name, copy_len) < copy_len) break;
        if (name_len > copy_len) lseek(zfd, name_len - copy_len, SEEK_CUR);
        if (extra_len > 0) lseek(zfd, extra_len, SEEK_CUR);

        if (compression != 0) {
            garlic_log("[Garlic] Skipping compressed entry: %s\n", name);
            lseek(zfd, comp_size, SEEK_CUR);
            continue;
        }

        if (name[0] && name[strlen(name) - 1] == '/') {
            /* Directory entry */
            char dirpath[MAX_PATH_LEN];
            snprintf(dirpath, sizeof(dirpath), "%s/%s", dest_dir, name);
            mkdir_p(dirpath);
            if (comp_size > 0) lseek(zfd, comp_size, SEEK_CUR);
        } else {
            /* File entry — stream to disk */
            char filepath[MAX_PATH_LEN];
            snprintf(filepath, sizeof(filepath), "%s/%s", dest_dir, name);

            /* Create parent directories */
            char *slash = filepath;
            while ((slash = strchr(slash + 1, '/')) != NULL) {
                *slash = 0;
                mkdir(filepath, 0777);
                *slash = '/';
            }

            int fd = open(filepath, O_CREAT | O_WRONLY | O_TRUNC, 0644);
            if (fd >= 0) {
                uint8_t buf[65536];
                size_t remaining = uncomp_size;
                while (remaining > 0) {
                    size_t chunk = remaining > sizeof(buf) ? sizeof(buf) : remaining;
                    ssize_t r = read(zfd, buf, chunk);
                    if (r <= 0) break;
                    write(fd, buf, r);
                    remaining -= r;
                }
                close(fd);
                count++;
            } else {
                lseek(zfd, comp_size, SEEK_CUR);
            }
        }
    }

    close(zfd);
    garlic_log("[Garlic] Extracted %d files from %s\n", count, zip_path);
    return count;
}

/* ── ZIP create helpers ────────────────────────────────────────── */
typedef struct {
    char name[512];
    uint32_t crc;
    uint32_t size;
    uint32_t offset;
} zip_entry_t;

#define MAX_ZIP_ENTRIES 4096

/* Function ZIP Collection */
static int collect_files(const char *base, const char *prefix,
                         zip_entry_t *entries, int *count) {
    char dirpath[MAX_PATH_LEN];
    int n = prefix[0] ? snprintf(dirpath, sizeof(dirpath), "%s/%s", base, prefix)
                      : snprintf(dirpath, sizeof(dirpath), "%s", base);
    if (n < 0 || (size_t)n >= sizeof(dirpath)) return -1;
    struct stat dir_st;
    if (lstat(dirpath, &dir_st) < 0 || !S_ISDIR(dir_st.st_mode)) return -1;
    DIR *d = opendir(dirpath);
    if (!d) return -1;
    int result = 0;
    for (;;) {
        errno = 0;
        struct dirent *ent = readdir(d);
        if (!ent) { if (errno) result = -1; break; }
        if (!strcmp(ent->d_name, ".") || !strcmp(ent->d_name, "..")) continue;
        char relpath[MAX_PATH_LEN], fullpath[MAX_PATH_LEN];
        n = prefix[0] ? snprintf(relpath, sizeof(relpath), "%s/%s", prefix, ent->d_name)
                      : snprintf(relpath, sizeof(relpath), "%s", ent->d_name);
        if (n < 0 || (size_t)n >= sizeof(relpath)) { result = -1; break; }
        n = snprintf(fullpath, sizeof(fullpath), "%s/%s", base, relpath);
        if (n < 0 || (size_t)n >= sizeof(fullpath)) { result = -1; break; }
        struct stat st;
        if (lstat(fullpath, &st) < 0) { result = -1; break; }
        if (S_ISDIR(st.st_mode)) {
            if (collect_files(base, relpath, entries, count) < 0) { result = -1; break; }
        } else if (S_ISREG(st.st_mode)) {
            if (*count >= MAX_ZIP_ENTRIES || strlen(relpath) >= sizeof(entries[0].name) ||
                st.st_size < 0 || (uint64_t)st.st_size > UINT32_MAX) { result = -1; break; }
            zip_entry_t *e = &entries[*count];
            strcpy(e->name, relpath);
            e->size = (uint32_t)st.st_size;
            e->crc = e->offset = 0;
            (*count)++;
        } else { result = -1; break; }
    }
    if (closedir(d) < 0) result = -1;
    return result;
}

/* Function ZIP Writing */
static int zip_write_all(int fd, const void *data, size_t size) {
    const uint8_t *p = data;
    while (size) {
        ssize_t n = write(fd, p, size);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        p += n; size -= (size_t)n;
    }
    return 0;
}

int zip_create_from_dir(const char *src_dir, const char *zip_path) {
    zip_entry_t *entries = malloc(MAX_ZIP_ENTRIES * sizeof(zip_entry_t));
    if (!entries) return -1;
    int count = 0, zfd = -1, fd = -1;
    if (collect_files(src_dir, "", entries, &count) < 0 || !count) goto failed;
    uint64_t total = 22;
    for (int i = 0; i < count; i++) {
        total += (uint64_t)entries[i].size + 76 + 2 * strlen(entries[i].name);
        if (total > UINT32_MAX) goto failed;
    }
    zfd = open(zip_path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (zfd < 0) goto failed;
    uint8_t buf[65536];
    uint32_t offset = 0;
    for (int i = 0; i < count; i++) {
        zip_entry_t *e = &entries[i];
        e->offset = offset;
        uint16_t nlen = (uint16_t)strlen(e->name);
        char fullpath[MAX_PATH_LEN];
        int n = snprintf(fullpath, sizeof(fullpath), "%s/%s", src_dir, e->name);
        if (n < 0 || (size_t)n >= sizeof(fullpath)) goto failed;
        int flags = O_RDONLY;
#ifdef O_NOFOLLOW
        flags |= O_NOFOLLOW;
#endif
        fd = open(fullpath, flags);
        struct stat st;
        if (fd < 0 || fstat(fd, &st) < 0 || !S_ISREG(st.st_mode) ||
            st.st_size < 0 || (uint64_t)st.st_size != e->size) goto failed;
        uint32_t crc = 0xFFFFFFFF;
        uint32_t remaining = e->size;
        while (remaining) {
            size_t chunk = remaining < sizeof(buf) ? remaining : sizeof(buf);
            ssize_t r = read(fd, buf, chunk);
            if (r < 0 && errno == EINTR) continue;
            if (r <= 0) goto failed;
            for (ssize_t j = 0; j < r; j++) crc = crc_tab[(crc ^ buf[j]) & 0xFF] ^ (crc >> 8);
            remaining -= (uint32_t)r;
        }
        e->crc = crc ^ 0xFFFFFFFF;
        if (lseek(fd, 0, SEEK_SET) < 0) goto failed;
        uint8_t lh[30] = {0};
        lh[0] = 0x50; lh[1] = 0x4b; lh[2] = 0x03; lh[3] = 0x04;
        lh[4] = 20;
        memcpy(lh + 14, &e->crc, 4);
        memcpy(lh + 18, &e->size, 4);
        memcpy(lh + 22, &e->size, 4);
        memcpy(lh + 26, &nlen, 2);
        if (zip_write_all(zfd, lh, sizeof(lh)) < 0 || zip_write_all(zfd, e->name, nlen) < 0) goto failed;
        remaining = e->size; crc = 0xFFFFFFFF;
        while (remaining) {
            size_t chunk = remaining < sizeof(buf) ? remaining : sizeof(buf);
            ssize_t r = read(fd, buf, chunk);
            if (r < 0 && errno == EINTR) continue;
            if (r <= 0 || zip_write_all(zfd, buf, (size_t)r) < 0) goto failed;
            for (ssize_t j = 0; j < r; j++) crc = crc_tab[(crc ^ buf[j]) & 0xFF] ^ (crc >> 8);
            remaining -= (uint32_t)r;
        }
        if ((crc ^ 0xFFFFFFFF) != e->crc || fstat(fd, &st) < 0 ||
            st.st_size < 0 || (uint64_t)st.st_size != e->size) goto failed;
        if (close(fd) < 0) { fd = -1; goto failed; }
        fd = -1;
        offset += 30 + nlen + e->size;
    }
    uint32_t cd_offset = offset;
    for (int i = 0; i < count; i++) {
        zip_entry_t *e = &entries[i];
        uint16_t nlen = (uint16_t)strlen(e->name);
        uint8_t cd[46] = {0};
        cd[0] = 0x50; cd[1] = 0x4b; cd[2] = 0x01; cd[3] = 0x02;
        cd[4] = 20; cd[6] = 20;
        memcpy(cd + 16, &e->crc, 4);
        memcpy(cd + 20, &e->size, 4);
        memcpy(cd + 24, &e->size, 4);
        memcpy(cd + 28, &nlen, 2);
        memcpy(cd + 42, &e->offset, 4);
        if (zip_write_all(zfd, cd, sizeof(cd)) < 0 || zip_write_all(zfd, e->name, nlen) < 0) goto failed;
        offset += 46 + nlen;
    }
    uint32_t cd_size = offset - cd_offset;
    uint8_t ecd[22] = {0};
    ecd[0] = 0x50; ecd[1] = 0x4b; ecd[2] = 0x05; ecd[3] = 0x06;
    uint16_t cnt16 = (uint16_t)count;
    memcpy(ecd + 8, &cnt16, 2); memcpy(ecd + 10, &cnt16, 2);
    memcpy(ecd + 12, &cd_size, 4); memcpy(ecd + 16, &cd_offset, 4);
    if (zip_write_all(zfd, ecd, sizeof(ecd)) < 0) goto failed;
    if (close(zfd) < 0) { zfd = -1; unlink(zip_path); goto failed; }
    zfd = -1;
    free(entries);
    garlic_log("[Garlic] Created ZIP %s (%d files)\n", zip_path, count);
    return 0;
failed:
    if (fd >= 0) close(fd);
    if (zfd >= 0) { close(zfd); unlink(zip_path); }
    free(entries);
    garlic_log("[Garlic] Cannot create complete classic ZIP %s\n", zip_path);
    return -1;
}
