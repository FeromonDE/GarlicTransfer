#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include "chives.h"
#include "util.h"

// Function Archive Values
static uint16_t local_u16(const uint8_t *value) {
    return (uint16_t)value[0] | (uint16_t)value[1] << 8;
}

static uint32_t local_u32(const uint8_t *value) {
    return (uint32_t)value[0] | (uint32_t)value[1] << 8 |
           (uint32_t)value[2] << 16 | (uint32_t)value[3] << 24;
}

// Function Archive Checking
int local_validate_zip(const char *filename, const char *destination) {
    struct stat st;
    if (stat(filename, &st) < 0 || st.st_size < 22) return -1;
    FILE *file = fopen(filename, "rb");
    if (!file) return -1;
    int result = -1, entries = 0;
    uint8_t end[22];
    if (fseeko(file, st.st_size - 22, SEEK_SET) || fread(end, 1, sizeof(end), file) != sizeof(end))
        goto finished;
    if (local_u32(end) != 0x06054b50 || local_u16(end + 4) || local_u16(end + 6) ||
        local_u16(end + 20)) goto finished;
    uint16_t expected = local_u16(end + 10);
    uint64_t directory_size = local_u32(end + 12), directory_start = local_u32(end + 16);
    if (!expected || expected == UINT16_MAX || local_u16(end + 8) != expected ||
        directory_start + directory_size != (uint64_t)st.st_size - 22) goto finished;
    if (fseeko(file, 0, SEEK_SET)) goto finished;
    uint64_t offset = 0;
    while (offset < directory_start) {
        uint8_t header[30];
        if (directory_start - offset < sizeof(header) ||
            fread(header, 1, sizeof(header), file) != sizeof(header)) goto finished;
        if (local_u32(header) != 0x04034b50 || (local_u16(header + 6) & 9) ||
            local_u16(header + 8) != 0) goto finished;
        uint32_t size = local_u32(header + 18);
        uint16_t name_size = local_u16(header + 26), extra_size = local_u16(header + 28);
        if (size == UINT32_MAX || size != local_u32(header + 22) || !name_size ||
            name_size >= MAX_PATH_LEN || strlen(destination) + name_size + 2 >= MAX_PATH_LEN)
            goto finished;
        uint64_t member_size = sizeof(header) + (uint64_t)name_size + extra_size + size;
        if (member_size > directory_start - offset) goto finished;
        char name[MAX_PATH_LEN];
        if (fread(name, 1, name_size, file) != name_size) goto finished;
        name[name_size] = 0;
        if (strlen(name) != name_size || !chives_path_safe(name) ||
            (name_size >= 2 && name[1] == ':')) goto finished;
        if (fseeko(file, (off_t)extra_size + size, SEEK_CUR)) goto finished;
        offset += member_size;
        if (++entries > expected) goto finished;
    }
    if (entries != expected) goto finished;
    for (int i = 0; i < expected; i++) {
        uint8_t header[46];
        if (directory_size < sizeof(header) ||
            fread(header, 1, sizeof(header), file) != sizeof(header)) goto finished;
        if (local_u32(header) != 0x02014b50 || (local_u16(header + 8) & 9) ||
            local_u16(header + 10) != 0 || local_u16(header + 34) != 0 ||
            local_u32(header + 42) >= directory_start) goto finished;
        uint64_t rest = (uint64_t)local_u16(header + 28) + local_u16(header + 30) + local_u16(header + 32);
        if (rest > directory_size - sizeof(header) || fseeko(file, (off_t)rest, SEEK_CUR)) goto finished;
        directory_size -= sizeof(header) + rest;
    }
    if (directory_size == 0) result = 0;
finished:
    fclose(file);
    return result;
}
