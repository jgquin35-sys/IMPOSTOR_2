const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const salas = new Map(); // codigo -> {jugadores: [], modo, categoria, palabraReal, numImpostores, hostId, enRonda: false}

// Categorías de palabras
const categorias = {
  animales: ['GATO', 'PERRO', 'VACA', 'CABALLO', 'CERDO', 'POLLO', 'PATO', 'RATON', 'LEON', 'TIGRE'],
  cuerpo: ['CABEZA', 'MANO', 'PIERNA', 'OJOS', 'BOCA', 'NARIZ', 'OREJA', 'PIE', 'BRAZO', 'CORAZON'],
  paises: ['ESPANA', 'FRANCIA', 'ITALIA', 'PORTUGAL', 'ALEMANIA', 'MARRUECOS', 'CHINA', 'JAPON', 'BRASIL', 'MEXICO'],
  utensilios: ['CUBIERTO', 'VASO', 'PLATO', 'CUCHARA', 'TENEDOR', 'CUBO', 'SILLA', 'MESA', 'LAMPARA', 'RELOJ'],
  colores: ['ROJO', 'AZUL', 'VERDE', 'AMARILLO', 'NEGRO', 'BLANCO', 'MORADO', 'NARANJA', 'ROSADO', 'GRIS'],
  deportes: ['FUTBOL', 'BALONCESTO', 'TENIS', 'NATACION', 'BOXEO', 'RUGBY', 'VOLEIBOL', 'GOLF', 'SKI', 'SURF'],
  personajes: ['PAQUITO', 'RAPHAEL', 'LOPEZ', 'SABINA', 'ALMODOVAR', 'PENELope', 'BARDem', 'CRUZ', 'BECKHAM', 'PAULA'],
  comidas: ['PIZZA', 'PAELLA', 'TORTILLA', 'GAZPACHO', 'JAMON', 'CHURROS', 'CROQUETA', 'EMPANADA', 'FABADA', 'CALDO'],
  trabajos: ['MEDICO', 'PROFESOR', 'POLICIA', 'BOMBERO', 'COCINERO', 'CARPINTERO', 'FONTANERO', 'VENDEDOR', 'PILOTO', 'ABOGADO'],
  ropa: ['CAMISETA', 'PANTALON', 'ZAPATO', 'SOMBRERO', 'CHAQUETA', 'BUFANDA', 'GUANTE', 'MEDIAS', 'VESTIDO', 'CORBATA'],
  clima: ['SOL', 'LLUVIA', 'NIEVE', 'VIENTO', 'NUBE', 'TORMENTA', 'ARCOS', 'GRANIZO', 'CALOR', 'FRO'],
  animales_magicos: ['DRAGON', 'UNICORNIO', 'FENIX', 'GRIFO', 'BASILISCO', ' esfinge', 'MINOTAURO', 'HIDRA', 'Pegaso', 'CENTAURO'],
  frutas: ['MANZANA', 'PLATANO', 'NARANJA', 'UVA', 'FRESAS', 'PERA', 'KIWI', 'MELON', 'SANDIA', 'CEREZA'],
  marcas: ['ZARA', 'INDITEX', 'MANGO', 'REPSOL', 'BBVA', 'SANTANDER', 'ELCORT', 'CARREFOUR', 'MEDIA', 'MAPFRE']
};

function obtenerPalabraAleatoria(modo, categoria) {
  if (modo === 'manual') return null;
  
  let todasPalabras = [];
  if (modo === 'random') {
    Object.values(categorias).forEach(cat => todasPalabras.push(...cat));
  } else if (modo === 'randomCategoria' && categoria && categorias[categoria]) {
    todasPalabras = categorias[categoria];
  }
  
  if (todasPalabras.length === 0) return 'ERROR';
  const indice = Math.floor(Math.random() * todasPalabras.length);
  return todasPalabras[indice];
}

function seleccionarImpostores(jugadores, numImpostores, excluirHostSiManual = false) {
  let candidatos = [...jugadores];
  
  // En modo manual, excluir al host
  if (excluirHostSiManual) {
    candidatos = candidatos.filter(j => !j.esHost);
  }
  
  // Asegurar suficientes candidatos
  if (candidatos.length < numImpostores) {
    return []; // No hay suficientes, nadie es impostor
  }
  
  // Mezclar y seleccionar
  for (let i = candidatos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidatos[i], candidatos[j]] = [candidatos[j], candidatos[i]];
  }
  
  return candidatos.slice(0, numImpostores).map(j => j.id);
}

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('configurar-partida', (data) => {
    const codigo = Math.random().toString(36).substr(2, 4).toUpperCase();
    
    salas.set(codigo, {
      jugadores: [{ id: socket.id, nombre: data.nombreHost, esHost: true }],
      modo: data.modo,
      categoria: data.categoria,
      palabraManual: data.modo === 'manual' ? data.palabraManual : null,
      palabraReal: null,
      numImpostores: data.numImpostores || 1,
      hostId: socket.id,
      enRonda: false
    });
    
    socket.emit('partida-configurada', { 
      codigo, 
      modo: data.modo, 
      categoria: data.categoria || null 
    });
    
    console.log(`Sala ${codigo} creada por ${data.nombreHost}`);
  });

  socket.on('unirse-partida', (data) => {
    const sala = salas.get(data.codigo);
    if (!sala) {
      socket.emit('error-unirse', 'Sala no encontrada');
      return;
    }
    
    // Verificar si ya está en la sala
    const yaExiste = sala.jugadores.some(j => j.nombre === data.nombre);
    if (yaExiste) {
      socket.emit('error-unirse', 'Ya hay alguien con ese nombre en la sala');
      return;
    }
    
    // Máximo 12 jugadores
    if (sala.jugadores.length >= 12) {
      socket.emit('error-unirse', 'Sala llena (máximo 12 jugadores)');
      return;
    }
    
    sala.jugadores.push({ id: socket.id, nombre: data.nombre, esHost: false });
    socket.join(data.codigo);
    
    socket.emit('partida-configurada', { 
      codigo: data.codigo, 
      modo: sala.modo, 
      categoria: sala.categoria || null 
    });
    
    io.to(data.codigo).emit('jugadores-actualizados', sala.jugadores);
    socket.emit('estado-espera', 'Esperando a todos los jugadores...');
    
    console.log(`${data.nombre} se unió a ${data.codigo} (${sala.jugadores.length}/12)`);
  });

  socket.on('iniciar-ronda', (codigo) => {
    const sala = salas.get(codigo);
    if (!sala) return;
    
    // Solo host puede iniciar
    if (socket.id !== sala.hostId) return;
    
    // Mínimo 3 jugadores
    if (sala.jugadores.length < 3) {
      socket.emit('error-ronda', 'Se necesitan al menos 3 jugadores');
      return;
    }
    
    sala.enRonda = true;
    
    // Obtener/decidir palabra real
    if (sala.modo === 'manual') {
      sala.palabraReal = sala.palabraManual;
    } else {
      sala.palabraReal = obtenerPalabraAleatoria(sala.modo, sala.categoria);
    }
    
    // Seleccionar impostores
    const excluirHost = sala.modo === 'manual';
    const impostoresIds = seleccionarImpostores(
      sala.jugadores, 
      sala.numImpostores, 
      excluirHost
    );
    
    console.log(`Ronda iniciada en ${codigo}: "${sala.palabraReal}" (${sala.numImpostores} impostor${sala.numImpostores > 1 ? 'es' : ''})`);
    
    // Enviar rol a cada jugador
    sala.jugadores.forEach(jugador => {
      const esImpostor = impostoresIds.includes(jugador.id);
      io.to(jugador.id).emit('tu-rol', {
        palabra: esImpostor ? '???' : sala.palabraReal,
        impostor: esImpostor,
        modo: sala.modo,
        categoria: sala.categoria
      });
    });
  });

  socket.on('solicitar-nueva-partida', (codigo) => {
    const sala = salas.get(codigo);
    if (!sala || socket.id !== sala.hostId) return;
    
    // Resetear para nueva ronda (mantener jugadores, configs)
    sala.enRonda = false;
    sala.palabraReal = null;
    
    // Pedir confirmación a todos
    sala.jugadores.forEach(j => {
      io.to(j.id).emit('nueva-partida-pedida', { codigo, segundos: 10 });
    });
  });

  socket.on('respuesta-nueva-partida', (data) => {
    const sala = salas.get(data.codigo);
    if (!sala) return;
    
    const jugador = sala.jugadores.find(j => j.id === socket.id);
    if (!jugador) return;
    
    jugador.aceptaNueva = data.acepta;
    
    // Si todos aceptaron o pasó el tiempo, reiniciar
    const todosAceptaron = sala.jugadores.every(j => j.aceptaNueva === true);
    if (todosAceptaron) {
      sala.jugadores.forEach(j => {
        io.to(j.id).emit('listo-para-nueva-ronda', { codigo: data.codigo });
      });
    }
  });

  socket.on('disconnect', () => {
    // Buscar en todas las salas y limpiar
    for (let [codigo, sala] of salas.entries()) {
      const indice = sala.jugadores.findIndex(j => j.id === socket.id);
      if (indice !== -1) {
        sala.jugadores.splice(indice, 1);
        
        // Si era host y quedan jugadores, pasar host al primero
        if (socket.id === sala.hostId && sala.jugadores.length > 0) {
          sala.hostId = sala.jugadores[0].id;
          sala.jugadores[0].esHost = true;
        }
        
        // Actualizar lista
        io.to(codigo).emit('jugadores-actualizados', sala.jugadores);
        
        // Limpiar sala vacía
        if (sala.jugadores.length === 0) {
          salas.delete(codigo);
          console.log(`Sala ${codigo} eliminada (vacía)`);
        } else {
          console.log(`${socket.id} desconectado de ${codigo} (${sala.jugadores.length} restantes)`);
        }
        
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
