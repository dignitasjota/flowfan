1. Crear token en Portainer                                                                                                                                                                                    
   
  En Portainer (Settings → Users → tu usuario):                                                                                                                                                                  
  - Copia el API Token (lo necesitarás)                     
                                                                                                                                                                                                                 
  2. Agregar secrets a GitHub                               
                                                                                                                                                                                                                 
  En tu repo → Settings → Secrets and variables → Actions → New repository secret:                                                                                                                               
   
  PORTAINER_URL = https://tu-vps-ip:9443                                                                                                                                                                         
  PORTAINER_API_TOKEN = (el token de arriba)                
  PORTAINER_STACK_NAME = fanflow                                                                                                                                                                                 
  REGISTRY_USERNAME = (DockerHub username o GitHub)         
  REGISTRY_PASSWORD = (DockerHub token o GitHub PAT)                                                                                                                                                             
  REGISTRY_URL = docker.io (DockerHub) o ghcr.io (GitHub Container Registry)                                                                                                                                     
                                                                                                                                                                                                                 
  3. Actualizar workflow de GitHub Actions                                                                                                                                                                       
                                                                                                                                                                                                                 
  Reemplaza el contenido de .github/workflows/ci.yml:                                                                                                                                                            
                                                            
  name: CI/CD                                                                                                                                                                                                    
                                                                                                                                                                                                                 
  on:
    push:                                                                                                                                                                                                        
      branches: [main]                                      
    pull_request:                                                                                                                                                                                                
      branches: [main]
                                                                                                                                                                                                                 
  env:                                                      
    REGISTRY: ${{ secrets.REGISTRY_URL }}
    IMAGE_NAME: fanflow
                                                                                                                                                                                                                 
  jobs:
    lint:                                                                                                                                                                                                        
      name: Lint                                                                                                                                                                                                 
      runs-on: ubuntu-latest
      steps:                                                                                                                                                                                                     
        - uses: actions/checkout@v4                         
        - uses: actions/setup-node@v4
          with:                                                                                                                                                                                                  
            node-version: 20
            cache: npm                                                                                                                                                                                           
        - run: npm ci                                                                                                                                                                                            
        - run: npm run lint                                                                                                                                                                                      
                                                                                                                                                                                                                 
    typecheck:                                              
      name: Type Check                                                                                                                                                                                           
      runs-on: ubuntu-latest                                
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:                                                                                                                                                                                                  
            node-version: 20                                                                                                                                                                                     
            cache: npm                                                                                                                                                                                           
        - run: npm ci                                                                                                                                                                                            
        - run: npx tsc --noEmit --skipLibCheck              

    build-image:                                                                                                                                                                                                 
      name: Build Docker Image
      runs-on: ubuntu-latest                                                                                                                                                                                     
      needs: [lint, typecheck]                              
      if: github.event_name == 'push' && github.ref == 'refs/heads/main'
      permissions:                                                                                                                                                                                               
        contents: read
        packages: write                                                                                                                                                                                          
      steps:                                                
        - uses: actions/checkout@v4

        - name: Set up Docker Buildx                                                                                                                                                                             
          uses: docker/setup-buildx-action@v3
                                                                                                                                                                                                                 
        - name: Log in to Registry                          
          uses: docker/login-action@v3                                                                                                                                                                           
          with:                                             
            registry: ${{ env.REGISTRY }}                                                                                                                                                                        
            username: ${{ secrets.REGISTRY_USERNAME }}
            password: ${{ secrets.REGISTRY_PASSWORD }}                                                                                                                                                           
                                                                                                                                                                                                                 
        - name: Extract metadata
          id: meta                                                                                                                                                                                               
          uses: docker/metadata-action@v5                   
          with:                                                                                                                                                                                                  
            images: ${{ env.REGISTRY }}/${{ secrets.REGISTRY_USERNAME }}/${{ env.IMAGE_NAME }}                                                                                                                   
            tags: |                                                                                                                                                                                              
              type=ref,event=branch                                                                                                                                                                              
              type=semver,pattern={{version}}               
              type=semver,pattern={{major}}.{{minor}}                                                                                                                                                            
              type=sha,prefix={{branch}}-                                                                                                                                                                        
              type=raw,value=latest,enable={{is_default_branch}}                                                                                                                                                 
                                                                                                                                                                                                                 
        - name: Build and push                                                                                                                                                                                   
          uses: docker/build-push-action@v5                                                                                                                                                                      
          with:                                             
            context: .
            push: true
            tags: ${{ steps.meta.outputs.tags }}                                                                                                                                                                 
            labels: ${{ steps.meta.outputs.labels }}
            cache-from: type=gha                                                                                                                                                                                 
            cache-to: type=gha,mode=max                     
            build-args: |                                                                                                                                                                                        
              NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${{ secrets.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY }}                                                                                                               
                                                                                                                                                                                                                 
    deploy:                                                                                                                                                                                                      
      name: Deploy to Portainer                                                                                                                                                                                  
      runs-on: ubuntu-latest                                                                                                                                                                                     
      needs: [build-image]
      if: github.event_name == 'push' && github.ref == 'refs/heads/main'                                                                                                                                         
      steps:                                                                                                                                                                                                     
        - uses: actions/checkout@v4                                                                                                                                                                              
                                                                                                                                                                                                                 
        - name: Get Portainer Stack ID                                                                                                                                                                           
          id: stack                                         
          run: |                                                                                                                                                                                                 
            STACK_ID=$(curl -s -k -X GET \                  
              "${{ secrets.PORTAINER_URL }}/api/stacks?filters=name%3D${{ secrets.PORTAINER_STACK_NAME }}" \                                                                                                     
              -H "X-API-Key: ${{ secrets.PORTAINER_API_TOKEN }}" | jq -r '.[0].Id')                                                                                                                              
            echo "stack_id=$STACK_ID" >> $GITHUB_OUTPUT                                                                                                                                                          
                                                                                                                                                                                                                 
        - name: Get latest image digest                                                                                                                                                                          
          id: image                                         
          run: |                                                                                                                                                                                                 
            IMAGE="${{ secrets.REGISTRY_USERNAME }}/${{ env.IMAGE_NAME }}:latest"
            echo "image=$IMAGE" >> $GITHUB_OUTPUT                                                                                                                                                                
                                                                                                                                                                                                                 
        - name: Update Stack (redeploy)                                                                                                                                                                          
          run: |                                                                                                                                                                                                 
            curl -s -k -X PUT \                                                                                                                                                                                  
              "${{ secrets.PORTAINER_URL }}/api/stacks/${{ steps.stack.outputs.stack_id }}?endpointId=2" \                                                                                                       
              -H "X-API-Key: ${{ secrets.PORTAINER_API_TOKEN }}" \                                                                                                                                               
              -H "Content-Type: application/json" \                                                                                                                                                              
              -d @- << EOF                                                                                                                                                                                       
            {                                                                                                                                                                                                    
              "stackFileContent": $(cat docker-compose.yml | jq -Rs .)
            }                                                                                                                                                                                                    
            EOF                                             
                                                                                                                                                                                                                 
        - name: Notify deployment                           
          run: |
            echo "✅ Deployment triggered for ${{ steps.image.outputs.image }}"
            echo "Check Portainer: ${{ secrets.PORTAINER_URL }}/#!/stacks/${{ steps.stack.outputs.stack_id }}"                                                                                                   
                                                                                                                                                                                                                 
  4. Opción simple: usar Watchtower (recomendado)                                                                                                                                                                
                                                                                                                                                                                                                 
  En vez de actualizar manualmente via API, usa Watchtower que monitorea cambios en Docker Hub/GHCR:                                                                                                             
                                                            
  Añade a tu docker-compose.yml:                                                                                                                                                                                 
                                                            
  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup                                                                                                                                                                            
    networks:
      - fanflow-network                                                                                                                                                                                          
                                                                                                                                                                                                                 
  Watchtower verificará cada 5 minutos si hay nueva imagen y actualizará automáticamente.                                                                                                                        
                                                                                                                                                                                                                 
  5. Configurar Docker Compose en Portainer                                                                                                                                                                      
                                                            
  En Stacks → fanflow:                                                                                                                                                                                           
   
  version: '3.8'                                                                                                                                                                                                 
                                                            
  services:
    app:
      image: docker.io/TU_USERNAME/fanflow:latest # Cambiar a tu registry
      restart: unless-stopped                                                                                                                                                                                    
      # ... resto de config
                                                                                                                                                                                                                 
  6. Workflow simplificado (recomendado para empezar)                                                                                                                                                            
   
  Si solo quieres build + push sin actualizar automáticamente:                                                                                                                                                   
                                                            
  name: Build & Push                                                                                                                                                                                             
                                                            
  on:
    push:
      branches: [main]
                                                                                                                                                                                                                 
  jobs:
    build:                                                                                                                                                                                                       
      runs-on: ubuntu-latest                                
      permissions:
        contents: read
        packages: write
      steps:
        - uses: actions/checkout@v4

        - name: Set up Docker Buildx                                                                                                                                                                             
          uses: docker/setup-buildx-action@v3
                                                                                                                                                                                                                 
        - name: Log in to Docker Hub                        
          uses: docker/login-action@v3                                                                                                                                                                           
          with:                                             
            username: ${{ secrets.DOCKER_USERNAME }}
            password: ${{ secrets.DOCKER_PASSWORD }}
                                                                                                                                                                                                                 
        - name: Build and push
          uses: docker/build-push-action@v5                                                                                                                                                                      
          with:                                             
            context: .
            push: true
            tags: ${{ secrets.DOCKER_USERNAME }}/fanflow:latest
            cache-from: type=gha                                                                                                                                                                                 
            cache-to: type=gha,mode=max
                                                                                                                                                                                                                 
  Luego en Portainer:                                                                                                                                                                                            
  1. Stack → Pull image
  2. O dejas Watchtower para que lo haga automáticamente                                                                                                                                                         
                                                            
  Checklist final                                                                                                                                                                                                
                                                            
  - Secrets añadidos a GitHub                                                                                                                                                                                    
  - .github/workflows/ci.yml actualizado                    
  - Docker Compose actualizado con nueva imagen (docker.io/username/fanflow:latest)                                                                                                                              
  - Watchtower o polling habilitado en Portainer                                                                                                                                                                 
  - Haz push a main y verifica GitHub Actions                                                                                                                                                                    
  - Verifica en Portainer que se actualizó el container                                                                                                                                                          
                                                                                                                                                                                                                 
  ¿Cuál prefieres: la opción con Watchtower (automática) o la manual con API?       