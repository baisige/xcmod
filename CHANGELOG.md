# Changelog

## Unreleased
- 增强插件配置的健壮性：在主进程新增数据契约校验，对保存的插件配置进行结构与字段校验，确保 id、name、executable、cheats 等的正确性，避免错误数据写入磁盘。
- 同步更新文档：新增 README.md，明确插件配置结构、字段含义、校验规则与示例，便于使用与扩展。
