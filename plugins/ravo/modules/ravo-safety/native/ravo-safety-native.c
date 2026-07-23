#define _DARWIN_C_SOURCE

#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct {
  char root[PATH_MAX];
  char relative[PATH_MAX];
  char quarantine[PATH_MAX];
  char snapshot_name[NAME_MAX];
  char source_name[NAME_MAX];
  char backup_name[NAME_MAX];
  char target_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  char source_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  uint64_t root_dev;
  uint64_t root_ino;
  uint64_t target_dev;
  uint64_t target_ino;
  uint64_t target_size;
  uint64_t target_mode;
  uint64_t target_uid;
  uint64_t target_gid;
  uint64_t quarantine_dev;
  uint64_t quarantine_ino;
  uint64_t source_dev;
  uint64_t source_ino;
  uint64_t source_size;
  uint64_t source_mode;
  uint64_t source_uid;
  uint64_t source_gid;
} Options;

static void json_error(const char *status, const char *message) {
  printf("{\"status\":\"%s\",\"message\":\"%s\"}\n", status, message);
}

static void json_error_with_snapshot(const char *status, const char *message, const struct stat *snapshot, const char *snapshot_name, const char *snapshot_sha) {
  printf("{\"status\":\"%s\",\"message\":\"%s\",\"snapshot\":{\"name\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"size\":%llu,\"mode\":%llu,\"uid\":%llu,\"gid\":%llu,\"sha256\":\"%s\"}}\n",
    status, message, snapshot_name, (unsigned long long)snapshot->st_dev, (unsigned long long)snapshot->st_ino, (unsigned long long)snapshot->st_size,
    (unsigned long long)snapshot->st_mode, (unsigned long long)snapshot->st_uid, (unsigned long long)snapshot->st_gid, snapshot_sha);
}

static const char *status_for_errno(int value) {
  if (value == ENOENT) return "target_missing";
  if (value == ELOOP || value == ENOTDIR || value == EXDEV) return "target_drift";
  if (value == EMLINK) return "not_supported";
  return "native_error";
}

static int copy_string(char *destination, size_t size, const char *source) {
  if (!source || strlen(source) >= size) return -1;
  memcpy(destination, source, strlen(source) + 1);
  return 0;
}

static int parse_u64(const char *source, uint64_t *destination) {
  char *end = NULL;
  errno = 0;
  unsigned long long value = strtoull(source, &end, 10);
  if (errno || !source[0] || !end || *end) return -1;
  *destination = (uint64_t)value;
  return 0;
}

static int is_hex_digest(const char *value) {
  if (!value || strlen(value) != CC_SHA256_DIGEST_LENGTH * 2) return 0;
  for (size_t index = 0; value[index]; index += 1) {
    const char current = value[index];
    if (!((current >= '0' && current <= '9') || (current >= 'a' && current <= 'f'))) return 0;
  }
  return 1;
}

static int is_safe_name(const char *value) {
  if (!value || !value[0] || strlen(value) >= NAME_MAX) return 0;
  if (!strcmp(value, ".") || !strcmp(value, "..")) return 0;
  return strchr(value, '/') == NULL;
}

static int is_safe_relative(const char *value) {
  if (!value || !value[0] || value[0] == '/' || strlen(value) >= PATH_MAX) return 0;
  char copy[PATH_MAX];
  if (copy_string(copy, sizeof(copy), value)) return 0;
  char *cursor = copy;
  char *part = NULL;
  while ((part = strsep(&cursor, "/")) != NULL) {
    if (!part[0] || !strcmp(part, ".") || !strcmp(part, "..")) return 0;
  }
  return 1;
}

static void hex_digest(const unsigned char *digest, char output[CC_SHA256_DIGEST_LENGTH * 2 + 1]) {
  static const char table[] = "0123456789abcdef";
  for (size_t index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    output[index * 2] = table[digest[index] >> 4];
    output[index * 2 + 1] = table[digest[index] & 0x0f];
  }
  output[CC_SHA256_DIGEST_LENGTH * 2] = '\0';
}

static int sha_fd(int fd, char output[CC_SHA256_DIGEST_LENGTH * 2 + 1], uint64_t *size) {
  if (lseek(fd, 0, SEEK_SET) < 0) return -1;
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  unsigned char buffer[65536];
  uint64_t total = 0;
  while (1) {
    ssize_t read_count = read(fd, buffer, sizeof(buffer));
    if (read_count < 0) return -1;
    if (read_count == 0) break;
    CC_SHA256_Update(&context, buffer, (CC_LONG)read_count);
    total += (uint64_t)read_count;
  }
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  hex_digest(digest, output);
  if (lseek(fd, 0, SEEK_SET) < 0) return -1;
  *size = total;
  return 0;
}

static int write_all(int fd, const unsigned char *buffer, size_t size) {
  size_t offset = 0;
  while (offset < size) {
    ssize_t written = write(fd, buffer + offset, size - offset);
    if (written < 0) return -1;
    offset += (size_t)written;
  }
  return 0;
}

static int copy_fd(int source, int destination, char output[CC_SHA256_DIGEST_LENGTH * 2 + 1], uint64_t *size) {
  if (lseek(source, 0, SEEK_SET) < 0) return -1;
  if (ftruncate(destination, 0) < 0 || lseek(destination, 0, SEEK_SET) < 0) return -1;
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  unsigned char buffer[65536];
  uint64_t total = 0;
  while (1) {
    ssize_t read_count = read(source, buffer, sizeof(buffer));
    if (read_count < 0) return -1;
    if (read_count == 0) break;
    if (write_all(destination, buffer, (size_t)read_count)) return -1;
    CC_SHA256_Update(&context, buffer, (CC_LONG)read_count);
    total += (uint64_t)read_count;
  }
  if (fsync(destination) < 0) return -1;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  hex_digest(digest, output);
  if (lseek(source, 0, SEEK_SET) < 0) return -1;
  *size = total;
  return 0;
}

static int copy_stdin(int destination, char output[CC_SHA256_DIGEST_LENGTH * 2 + 1], uint64_t *size) {
  if (ftruncate(destination, 0) < 0 || lseek(destination, 0, SEEK_SET) < 0) return -1;
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  unsigned char buffer[65536];
  uint64_t total = 0;
  while (1) {
    ssize_t read_count = read(STDIN_FILENO, buffer, sizeof(buffer));
    if (read_count < 0) return -1;
    if (read_count == 0) break;
    if (write_all(destination, buffer, (size_t)read_count)) return -1;
    CC_SHA256_Update(&context, buffer, (CC_LONG)read_count);
    total += (uint64_t)read_count;
  }
  if (fsync(destination) < 0) return -1;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  hex_digest(digest, output);
  *size = total;
  return 0;
}

static int same_identity(const struct stat *stat_value, uint64_t dev, uint64_t ino, uint64_t size, uint64_t mode, uint64_t uid, uint64_t gid) {
  return (uint64_t)stat_value->st_dev == dev && (uint64_t)stat_value->st_ino == ino && (uint64_t)stat_value->st_size == size
    && (uint64_t)stat_value->st_mode == mode && (uint64_t)stat_value->st_uid == uid && (uint64_t)stat_value->st_gid == gid;
}

static int open_verified_directory(const char *path, uint64_t dev, uint64_t ino, int require_same_device, uint64_t root_dev) {
  int flags = O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW_ANY;
  int fd = open(path, flags);
  if (fd < 0) return -1;
  struct stat stat_value;
  if (fstat(fd, &stat_value) || !S_ISDIR(stat_value.st_mode) || (uint64_t)stat_value.st_dev != dev || (uint64_t)stat_value.st_ino != ino || (require_same_device && (uint64_t)stat_value.st_dev != root_dev)) {
    close(fd);
    errno = ESTALE;
    return -1;
  }
  return fd;
}

static int open_verified_target(int root_fd, const Options *options, struct stat *target_stat, char target_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1]) {
  int flags = O_RDWR | O_CLOEXEC | O_NOFOLLOW_ANY | O_RESOLVE_BENEATH | O_UNIQUE;
  int fd = openat(root_fd, options->relative, flags);
  if (fd < 0) return -1;
  if (fstat(fd, target_stat) || !S_ISREG(target_stat->st_mode) || target_stat->st_nlink != 1 || !same_identity(target_stat, options->target_dev, options->target_ino, options->target_size, options->target_mode, options->target_uid, options->target_gid)) {
    close(fd);
    errno = ESTALE;
    return -1;
  }
  uint64_t size = 0;
  if (sha_fd(fd, target_sha, &size) || size != options->target_size || strcmp(target_sha, options->target_sha)) {
    close(fd);
    errno = ESTALE;
    return -1;
  }
  return fd;
}

static int open_snapshot_output(int quarantine_fd, const char *name, char temporary[NAME_MAX]) {
  if (!is_safe_name(name)) {
    errno = EINVAL;
    return -1;
  }
  int written = snprintf(temporary, NAME_MAX, ".%s.%ld.tmp", name, (long)getpid());
  if (written < 0 || written >= NAME_MAX) {
    errno = ENAMETOOLONG;
    return -1;
  }
  return openat(quarantine_fd, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW_ANY, 0600);
}

static int snapshot_target(int target_fd, int quarantine_fd, const char *name, char output_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1], uint64_t *output_size, struct stat *snapshot_stat) {
  char temporary[NAME_MAX];
  int snapshot_fd = open_snapshot_output(quarantine_fd, name, temporary);
  if (snapshot_fd < 0) return -1;
  int result = copy_fd(target_fd, snapshot_fd, output_sha, output_size);
  if (!result && fchmod(snapshot_fd, 0600) < 0) result = -1;
  if (!result && fsync(snapshot_fd) < 0) result = -1;
  if (!result && fstat(snapshot_fd, snapshot_stat) < 0) result = -1;
  if (close(snapshot_fd) < 0) result = -1;
  if (result) {
    unlinkat(quarantine_fd, temporary, 0);
    return -1;
  }
  if (renameat(quarantine_fd, temporary, quarantine_fd, name) < 0) {
    unlinkat(quarantine_fd, temporary, 0);
    return -1;
  }
  if (fsync(quarantine_fd) < 0) return -1;
  return 0;
}

static int open_verified_source(int quarantine_fd, const Options *options, struct stat *source_stat, char source_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1]) {
  if (!is_safe_name(options->source_name)) {
    errno = EINVAL;
    return -1;
  }
  int fd = openat(quarantine_fd, options->source_name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW_ANY | O_UNIQUE);
  if (fd < 0) return -1;
  if (fstat(fd, source_stat) || !S_ISREG(source_stat->st_mode) || source_stat->st_nlink != 1 || !same_identity(source_stat, options->source_dev, options->source_ino, options->source_size, options->source_mode, options->source_uid, options->source_gid)) {
    close(fd);
    errno = ESTALE;
    return -1;
  }
  uint64_t size = 0;
  if (sha_fd(fd, source_sha, &size) || size != options->source_size || strcmp(source_sha, options->source_sha)) {
    close(fd);
    errno = ESTALE;
    return -1;
  }
  return fd;
}

static void output_success(const struct stat *before, const char *before_sha, const struct stat *after, const char *after_sha, const struct stat *snapshot, const char *snapshot_name, const char *snapshot_sha) {
  printf("{\"status\":\"ok\",\"before\":{\"dev\":%llu,\"ino\":%llu,\"size\":%llu,\"mode\":%llu,\"uid\":%llu,\"gid\":%llu,\"sha256\":\"%s\"},\"after\":{\"dev\":%llu,\"ino\":%llu,\"size\":%llu,\"mode\":%llu,\"uid\":%llu,\"gid\":%llu,\"sha256\":\"%s\"},\"snapshot\":{\"name\":\"%s\",\"dev\":%llu,\"ino\":%llu,\"size\":%llu,\"mode\":%llu,\"uid\":%llu,\"gid\":%llu,\"sha256\":\"%s\"}}\n",
    (unsigned long long)before->st_dev, (unsigned long long)before->st_ino, (unsigned long long)before->st_size, (unsigned long long)before->st_mode, (unsigned long long)before->st_uid, (unsigned long long)before->st_gid, before_sha,
    (unsigned long long)after->st_dev, (unsigned long long)after->st_ino, (unsigned long long)after->st_size, (unsigned long long)after->st_mode, (unsigned long long)after->st_uid, (unsigned long long)after->st_gid, after_sha,
    snapshot_name, (unsigned long long)snapshot->st_dev, (unsigned long long)snapshot->st_ino, (unsigned long long)snapshot->st_size, (unsigned long long)snapshot->st_mode, (unsigned long long)snapshot->st_uid, (unsigned long long)snapshot->st_gid, snapshot_sha);
}

static int require_options(const Options *options, int restore) {
  if (!options->root[0] || !options->quarantine[0] || !is_safe_relative(options->relative) || !is_safe_name(options->snapshot_name) || !is_hex_digest(options->target_sha)) return -1;
  if (restore && (!is_safe_name(options->source_name) || !is_safe_name(options->backup_name) || !is_hex_digest(options->source_sha))) return -1;
  return 0;
}

static int parse_options(int argc, char **argv, Options *options) {
  memset(options, 0, sizeof(*options));
  for (int index = 2; index < argc; index += 2) {
    if (index + 1 >= argc) return -1;
    const char *key = argv[index];
    const char *value = argv[index + 1];
    if (!strcmp(key, "--root")) { if (copy_string(options->root, sizeof(options->root), value)) return -1; }
    else if (!strcmp(key, "--relative")) { if (copy_string(options->relative, sizeof(options->relative), value)) return -1; }
    else if (!strcmp(key, "--quarantine")) { if (copy_string(options->quarantine, sizeof(options->quarantine), value)) return -1; }
    else if (!strcmp(key, "--snapshot-name")) { if (copy_string(options->snapshot_name, sizeof(options->snapshot_name), value)) return -1; }
    else if (!strcmp(key, "--source-name")) { if (copy_string(options->source_name, sizeof(options->source_name), value)) return -1; }
    else if (!strcmp(key, "--backup-name")) { if (copy_string(options->backup_name, sizeof(options->backup_name), value)) return -1; }
    else if (!strcmp(key, "--target-sha")) { if (copy_string(options->target_sha, sizeof(options->target_sha), value)) return -1; }
    else if (!strcmp(key, "--source-sha")) { if (copy_string(options->source_sha, sizeof(options->source_sha), value)) return -1; }
    else if (!strcmp(key, "--root-dev")) { if (parse_u64(value, &options->root_dev)) return -1; }
    else if (!strcmp(key, "--root-ino")) { if (parse_u64(value, &options->root_ino)) return -1; }
    else if (!strcmp(key, "--target-dev")) { if (parse_u64(value, &options->target_dev)) return -1; }
    else if (!strcmp(key, "--target-ino")) { if (parse_u64(value, &options->target_ino)) return -1; }
    else if (!strcmp(key, "--target-size")) { if (parse_u64(value, &options->target_size)) return -1; }
    else if (!strcmp(key, "--target-mode")) { if (parse_u64(value, &options->target_mode)) return -1; }
    else if (!strcmp(key, "--target-uid")) { if (parse_u64(value, &options->target_uid)) return -1; }
    else if (!strcmp(key, "--target-gid")) { if (parse_u64(value, &options->target_gid)) return -1; }
    else if (!strcmp(key, "--quarantine-dev")) { if (parse_u64(value, &options->quarantine_dev)) return -1; }
    else if (!strcmp(key, "--quarantine-ino")) { if (parse_u64(value, &options->quarantine_ino)) return -1; }
    else if (!strcmp(key, "--source-dev")) { if (parse_u64(value, &options->source_dev)) return -1; }
    else if (!strcmp(key, "--source-ino")) { if (parse_u64(value, &options->source_ino)) return -1; }
    else if (!strcmp(key, "--source-size")) { if (parse_u64(value, &options->source_size)) return -1; }
    else if (!strcmp(key, "--source-mode")) { if (parse_u64(value, &options->source_mode)) return -1; }
    else if (!strcmp(key, "--source-uid")) { if (parse_u64(value, &options->source_uid)) return -1; }
    else if (!strcmp(key, "--source-gid")) { if (parse_u64(value, &options->source_gid)) return -1; }
    else return -1;
  }
  return 0;
}

static int mutate(const char *operation, const Options *options) {
  const int restore = !strcmp(operation, "restore");
  if (require_options(options, restore)) {
    json_error("invalid_request", "invalid native safety arguments");
    return 2;
  }
  int root_fd = open_verified_directory(options->root, options->root_dev, options->root_ino, 0, 0);
  if (root_fd < 0) {
    json_error("target_drift", "authorized root identity changed");
    return 2;
  }
  struct stat before_stat;
  char before_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  int target_fd = open_verified_target(root_fd, options, &before_stat, before_sha);
  if (target_fd < 0) {
    const char *status = errno == ENOENT ? "target_missing" : (errno == EMLINK ? "not_supported" : "target_drift");
    close(root_fd);
    json_error(status, "target identity could not be verified");
    return 2;
  }
  int quarantine_fd = open_verified_directory(options->quarantine, options->quarantine_dev, options->quarantine_ino, 1, options->root_dev);
  if (quarantine_fd < 0) {
    close(target_fd);
    close(root_fd);
    json_error("recovery_failed", "quarantine identity or device changed");
    return 2;
  }
  struct stat snapshot_stat;
  char snapshot_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  uint64_t snapshot_size = 0;
  char mutation_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  uint64_t mutation_size = 0;
  int result = 0;
  int snapshot_created = 0;
  if (restore) {
    struct stat source_stat;
    char source_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
    int source_fd = open_verified_source(quarantine_fd, options, &source_stat, source_sha);
    if (source_fd < 0) {
      close(quarantine_fd);
      close(target_fd);
      close(root_fd);
      json_error("recovery_failed", "recovery source identity changed");
      return 2;
    }
    result = snapshot_target(target_fd, quarantine_fd, options->backup_name, snapshot_sha, &snapshot_size, &snapshot_stat);
    if (!result) snapshot_created = 1;
    if (!result) result = copy_fd(source_fd, target_fd, mutation_sha, &mutation_size);
    close(source_fd);
  } else {
    result = snapshot_target(target_fd, quarantine_fd, options->snapshot_name, snapshot_sha, &snapshot_size, &snapshot_stat);
    if (!result) snapshot_created = 1;
    if (!result && !strcmp(operation, "truncate")) {
      if (ftruncate(target_fd, 0) < 0 || fsync(target_fd) < 0) result = -1;
    }
    if (!result && !strcmp(operation, "replace")) result = copy_stdin(target_fd, mutation_sha, &mutation_size);
  }
  if (result) {
    int saved = errno;
    close(quarantine_fd);
    close(target_fd);
    close(root_fd);
    const char *snapshot_name = restore ? options->backup_name : options->snapshot_name;
    if (snapshot_created) json_error_with_snapshot(status_for_errno(saved), "snapshot succeeded but mutation failed", &snapshot_stat, snapshot_name, snapshot_sha);
    else json_error(status_for_errno(saved), "snapshot or mutation failed");
    return 2;
  }
  struct stat after_stat;
  char after_sha[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  uint64_t after_size = 0;
  if (fstat(target_fd, &after_stat) || sha_fd(target_fd, after_sha, &after_size) || (uint64_t)after_stat.st_size != after_size) {
    close(quarantine_fd);
    close(target_fd);
    close(root_fd);
    json_error("safety_violation", "post-mutation identity could not be recorded");
    return 2;
  }
  const char *snapshot_name = restore ? options->backup_name : options->snapshot_name;
  output_success(&before_stat, before_sha, &after_stat, after_sha, &snapshot_stat, snapshot_name, snapshot_sha);
  close(quarantine_fd);
  close(target_fd);
  close(root_fd);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "--probe")) {
    printf("{\"status\":\"ok\",\"platform\":\"darwin\",\"flags\":{\"noFollowAny\":%d,\"resolveBeneath\":%d,\"unique\":%d}}\n", O_NOFOLLOW_ANY, O_RESOLVE_BENEATH, O_UNIQUE);
    return 0;
  }
  if (argc < 4 || (strcmp(argv[1], "truncate") && strcmp(argv[1], "replace") && strcmp(argv[1], "restore"))) {
    json_error("invalid_request", "usage: ravosafety-native truncate|replace|restore options");
    return 2;
  }
  Options options;
  if (parse_options(argc, argv, &options)) {
    json_error("invalid_request", "invalid native safety arguments");
    return 2;
  }
  return mutate(argv[1], &options);
}
