/** @type {import('next').NextConfig} */
// transpilePackages: the landing pricing cards import the plan config from
// @studyfy/shared-types (§16.1 single source of truth).
const nextConfig = {
  transpilePackages: ["@studyfy/shared-types"],
};

export default nextConfig;
