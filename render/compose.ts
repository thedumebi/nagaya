// generated/compose/*.yml
//
//   core.yml        caddy, every postgres and redis resource. One compose
//                   project, `nagaya-core`, started by `nagaya apply`.
//   <project>.yml   one per deployable project (ofuma-main, ofuma-main-stg…).
//
// Project networks and the edge network are created by `nagaya apply`, not by
// compose (they are `external: true` here). Resources are attached to each
// project network with `docker network connect --alias`, outside compose, so
// adding a site never makes compose recreate Postgres for every other tenant.

import { stringify } from 'yaml'
import { CORE_PROJECT, EDGE_NETWORK, PROJECT_LABEL, ROOT } from './constants.ts'
import { HEADER } from './header.ts'
import type { Model, Project } from './types/index.ts'

function toYaml(document: unknown): string {
  return stringify(document, { lineWidth: 0, aliasDuplicateObjects: false })
}

// 75% of the container cap, so Redis refuses writes (or evicts, per policy)
// on its own terms before the kernel OOM-kills it and drops every key.
function redisMaxMemory(containerMemory: string): string {
  const amount = Number.parseInt(containerMemory, 10)
  const megabytes = containerMemory.endsWith('g') ? amount * 1024 : amount
  return `${Math.floor(megabytes * 0.75)}mb`
}

export function renderCore(model: Model): string {
  const services: Record<string, unknown> = {}
  const volumes: Record<string, object> = {
    'caddy-data': {},
    'caddy-config': {},
  }

  services.caddy = {
    image: 'caddy:2-alpine',
    container_name: 'caddy',
    restart: 'unless-stopped',
    // 443 only. Cloudflare reaches the origin over HTTPS (Full strict), and
    // the firewall admits only Cloudflare's ranges, so nothing needs port 80.
    ports: ['443:443'],
    volumes: [
      // The DIRECTORY, not the file. A single-file bind mount pins the inode,
      // so after `git pull` replaces the Caddyfile the container would keep
      // reading the old one and `caddy reload` would silently change nothing.
      `${ROOT}/generated/caddy:/etc/caddy:ro`,
      `${ROOT}/certs:/certs:ro`,
      `${ROOT}/static:/srv/static:ro`,
      'caddy-data:/data',
      'caddy-config:/config',
    ],
    mem_limit: '128m',
    networks: [EDGE_NETWORK],
    labels: { [PROJECT_LABEL]: CORE_PROJECT },
  }

  for (const [postgresName, postgresConfig] of Object.entries(model.registry.resources.postgres)) {
    volumes[`${postgresName}-data`] = {}
    services[postgresName] = {
      image: `postgres:${postgresConfig.version}-alpine`,
      container_name: postgresName,
      restart: 'unless-stopped',
      command: [
        'postgres',
        '-c',
        `shared_buffers=${postgresConfig.shared_buffers}`,
        '-c',
        `max_connections=${postgresConfig.max_connections}`,
      ],
      environment: {
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: '${PG_SUPERUSER_PASSWORD:?run through dotenvx (nagaya does this)}',
      },
      // On the box's loopback only, for an SSH tunnel from the laptop. Apps
      // never use this: they reach Postgres over the Docker networks on 5432.
      ports: [`127.0.0.1:${postgresConfig.tunnel_port}:5432`],
      // Postgres 18 images keep data in /var/lib/postgresql/<major>/docker and
      // declare the volume at /var/lib/postgresql. Mount there, not at
      // .../data (the 16-and-older layout, which the 18 entrypoint flags as an
      // unused mount). This layout also lets a future major upgrade keep both
      // versions' data directories side by side on one volume.
      volumes: [`${postgresName}-data:/var/lib/postgresql`],
      shm_size: '128m',
      mem_limit: postgresConfig.mem,
      stop_grace_period: '60s',
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready -U postgres'],
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      labels: { [PROJECT_LABEL]: CORE_PROJECT },
    }
  }

  // Redis publishes no port at all: only containers use it, over the Docker
  // networks, and each container has its own address, so several Redis can
  // all listen on 6379 without clashing.
  for (const [redisName, redisConfig] of Object.entries(model.registry.resources.redis)) {
    volumes[`${redisName}-data`] = {}
    const command = ['redis-server', '--appendonly', 'yes', '--maxmemory', redisMaxMemory(redisConfig.mem)]
    if (redisConfig.policy)
      command.push('--maxmemory-policy', redisConfig.policy)
    if (redisConfig.password_env)
      command.push('--requirepass', `\${${redisConfig.password_env}:?run through dotenvx (nagaya does this)}`)
    services[redisName] = {
      image: `redis:${redisConfig.version}-alpine`,
      container_name: redisName,
      restart: 'unless-stopped',
      command,
      volumes: [`${redisName}-data:/data`],
      mem_limit: redisConfig.mem,
      labels: { [PROJECT_LABEL]: CORE_PROJECT },
    }
  }

  return HEADER('#') + toYaml({
    name: CORE_PROJECT,
    services,
    networks: { [EDGE_NETWORK]: { name: EDGE_NETWORK, external: true } },
    volumes,
  })
}

export function renderProject(project: Project): string {
  const services: Record<string, unknown> = {}

  for (const service of project.services) {
    const serviceNetworks: Record<string, object> = { site: { aliases: service.aliases } }
    if (service.public)
      serviceNetworks[EDGE_NETWORK] = {}

    const composeService: Record<string, unknown> = {
      image: `${service.image}:\${TAG:?not deployed yet; run nagaya deploy ${project.id} <tag>}`,
      container_name: service.container,
      restart: 'unless-stopped',
    }
    if (service.command)
      composeService.command = ['sh', '-c', service.command]
    // Start order within this project only. Postgres and Redis live in the
    // core project, which compose cannot reference; `nagaya apply` starts and
    // waits for them before any project, and a backend that still loses the
    // race exits on its failed migration and is restarted by Docker.
    if (service.dependsOn.length)
      composeService.depends_on = service.dependsOn
    // The only value nagaya passes: which environment this is. Everything
    // else an app needs comes from the files baked into its own image.
    composeService.environment = { NODE_ENV: service.nodeEnv }
    if (service.dotenvx) {
      // ONLY this environment's DOTENV_PRIVATE_KEY_*: a staging container never
      // holds the production key. nagaya splits it out of the .keys file.
      composeService.env_file = [service.dotenvx.keyFile]
    }
    composeService.mem_limit = service.mem
    if (service.mounts.length)
      composeService.volumes = service.mounts.map(mount => `${mount.host}:${mount.at}`)
    composeService.labels = { [PROJECT_LABEL]: project.id }
    composeService.networks = serviceNetworks
    services[service.key] = composeService
  }

  const projectNetworks: Record<string, object> = { site: { name: project.network, external: true } }
  if (project.services.some(service => service.public))
    projectNetworks[EDGE_NETWORK] = { name: EDGE_NETWORK, external: true }

  return HEADER('#') + toYaml({ name: project.id, services, networks: projectNetworks })
}
