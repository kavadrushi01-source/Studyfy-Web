#!/bin/sh
set -e
chown -R runner:runner /opt/actions-runner
echo "runner ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/runner
chmod 440 /etc/sudoers.d/runner
TOKEN=$(tr -d '\r\n' < /mnt/c/Users/kavad/AppData/Local/Temp/runner-token.txt)
su runner -c "cd /opt/actions-runner && ./config.sh --url https://github.com/kavadrushi01-source/Studyfy-Web --token $TOKEN --labels self-hosted,linux --unattended --replace && ./svc.sh install && ./svc.sh start && sleep 3 && ./svc.sh status | head -3"
