Análisis del Proyecto FanFlow v2

  SEGURIDAD (Prioridad Alta)

  1. Rate limiting inexistente
  No hay protección contra fuerza bruta en login, registro ni en las APIs. Alguien puede hacer miles de peticiones/segundo.
  - /api/auth/register — sin rate limit
  - /api/auth/[...nextauth] — sin rate limit
  - Todas las mutations de tRPC — sin throttling

  2. API keys de IA almacenadas en texto plano
  En aiConfigs y aiModelAssignments las API keys se guardan sin cifrar en la BD. Si alguien accede a la BD, tiene todas las keys.

  3. El registro no valida fuerza de contraseña
  Solo pide min(8). No exige mayúsculas, números ni caracteres especiales.

  4. No hay CSRF protection explícita
  NextAuth maneja CSRF para sus rutas, pero el endpoint /api/auth/register es una ruta raw de Next.js sin protección CSRF.

  5. docker-compose.yml tiene credenciales hardcodeadas
  POSTGRES_PASSWORD: fanflow_secret en producción es inseguro. Debería usar secrets o .env.

  ---
  ARQUITECTURA (Prioridad Alta)

  6. No hay tests
  Cero archivos de test en el proyecto. Ni unitarios, ni de integración, ni e2e. Para un SaaS con billing esto es crítico — un bug en el webhook de Stripe o en los checks de límites puede costar dinero.

  7. No hay middleware de autenticación para rutas dashboard
  El src/middleware.ts actual solo setea un header. No verifica sesión. La protección la hace el layout de dashboard, pero el middleware de Next.js es el lugar correcto para proteger rutas antes de renderizar.

  8. El worker (BullMQ) no se usa
  Hay bullmq e ioredis como dependencias, un script npm run worker, y docker-compose.yml define un servicio worker, pero no encontré colas ni jobs implementados. Los análisis de mensajes se hacen
  fire-and-forget en el request.

  9. Las API keys de IA no se validan al resolver
  ai-config-resolver.ts usa db: any como tipo. Pierde todo type-safety.

  10. conversations.create no verifica ownership del contacto
  Un usuario podría crear una conversación con un contactId de otro creator. Falta validar eq(contacts.creatorId, ctx.creatorId).

  ---
  FUNCIONALIDAD (Prioridad Media)

  11. No hay búsqueda ni filtros en conversaciones/contactos
  Las listas cargan todo sin paginación real. Con muchos contactos esto será lento y la UX mala.

  12. No hay paginación en mensajes en el frontend
  conversations.getById carga TODOS los mensajes de una conversación. Con conversaciones largas, esto es un problema de performance.

  13. No hay funcionalidad de "olvidar contraseña"
  No existe recuperación de contraseña. Si un usuario la olvida, no tiene forma de entrar.

  14. No hay confirmación de email
  El registro crea la cuenta inmediatamente sin verificar que el email sea real.

  15. No hay funcionalidad de eliminar cuenta
  Para GDPR/compliance, los usuarios deberían poder eliminar su cuenta y datos.

  16. No hay dark/light mode toggle
  Todo es dark mode forzado. Algunos usuarios prefieren light mode.

  17. El export de datos (intelligence.exportContactsData) no respeta los límites del plan
  El plan define qué tipos de export están permitidos (none/csv/csv_json/csv_json_api), pero el router de intelligence no lo verifica.

  ---
  UX/UI (Prioridad Media)

  18. No hay loading skeletons
  Las páginas muestran "Cargando..." en texto plano. Skeletons serían mejor UX.

  19. No hay toasts/notificaciones de éxito
  Cuando se crea un contacto, se guarda un template, etc., no hay feedback visual de éxito. Solo hay feedback en errores.

  20. La landing no tiene SEO
  No hay metadata export en page.tsx, ni <meta> tags, ni Open Graph, ni sitemap.

  21. El onboarding no se puede saltar completamente
  Si un usuario quiere ir directo al dashboard sin configurar nada, no puede. El redirect en el layout lo fuerza al onboarding.

  22. No hay responsive testing visible
  La landing y billing podrían tener problemas en móvil con las tablas de pricing de 4 columnas.

  ---
  DEVOPS/INFRA (Prioridad Baja)

  23. No hay CI/CD
  No hay GitHub Actions, ni pipeline de deploy. Todo es manual.

  24. El Dockerfile no incluye las variables de Stripe
  docker-compose.yml pasa ANTHROPIC_API_KEY pero no las variables de Stripe nuevas.

  25. No hay health check endpoint
  Para monitoring en producción (Portainer, uptime checks), falta un /api/health.

  26. No hay logging estructurado
  Todo usa console.error. En producción debería haber un logger (pino, winston) con niveles y formato JSON.

  ---
  DEUDA TÉCNICA (Prioridad Baja)

  27. Enum de platformType repetido en 5 archivos
  La lista ["instagram", "tinder", ...] se repite como string literal en cada router. Debería ser una constante compartida.

  28. messages.list usa throw new Error en vez de TRPCError
  Los errores en el router de messages no usan TRPCError, así que llegan al frontend como INTERNAL_SERVER_ERROR en vez de NOT_FOUND.

  29. No hay optimistic updates en mutations de tRPC
  Las mutations (crear contacto, enviar mensaje, etc.) esperan la respuesta del server para actualizar la UI. Con optimistic updates la UX sería más rápida.