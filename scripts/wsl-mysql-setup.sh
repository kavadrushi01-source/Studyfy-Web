#!/bin/sh
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS studyfy_test;
ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'root';
FLUSH PRIVILEGES;
SQL
mysql -uroot -proot -h127.0.0.1 -e "SELECT 'TCP-OK'; SHOW DATABASES LIKE 'studyfy_test';"
