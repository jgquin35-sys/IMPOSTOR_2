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
app.get('/ping', (req, res) => res.send('OK'));

// Diccionario de palabras por categoría
const palabras = {
  animales: ["GATO","PERRO","VACA","CABALLO","LEON","TIGRE","OSO","ELEFANTE","JIRAFA","ZEBRA"],
  cuerpo: ["CABEZA","BOCA","OJOS","NARIZ","OREJA","PIERNA","PIE","MANO","BRAZO","CORAZON"],
  paises: ["ESPANA","FRANCIA","ITALIA","PORTUGAL","ALEMANIA","INGLATERRA","RUSIA","CHINA","JAPON","BRASIL"],
  utensilios: ["VASO","PLATO","CUBIERTO","CUCHILLO","TENEDOR","CucharA","SARTEN","OLLAS","PAELLA","FRIGODERAS"],
  colores: ["ROJO","AZUL","VERDE","AMARILLO","NEGRO","BLANCO","MORADO","ROSAS","NARANJA","GRIS"],
  deportes: ["FUTBOL","BALONCESTO","TENIS","NATACION","BOXEO","RUGBY","GOLF","ESQUI","SURF","KARATE"],
  personajes: ["PAQUITO","RAPHAEL","ALMODOVAR","BARDENAS","AMANTES","PENELope","CRUZ","BEGONA","ANTONIO","BANDERAS"],
  comidas: ["PAELLA","TORREJAS","TORTILLA","JAMON","QuesO","PAN","LECHUGA","TOMATE","CEBOLLA","PIMIENTO"],
  trabajos: ["MEDICO","ENFERMERA","MAESTRO","POLICIA","BOMBERO","COCINERO","PANADERO","CARPINTERO","FONTANERO","VENDEDOR"],
  ropa: ["CAMISETA","PANTALON","ZAPATOS","SUDADERA","CHAQUETA","Gorra","BUFANDA","GUANTES","MEDIAS","BATA"],
  clima: ["SOL","LLUVIA","NIEVE","VIENTO","NUBE","TORMENTA","ARCOS","RAYOS","GRANIZO","HELADA"],
  animales_magicos: ["DRAGON","FENIX","GRIFON","UNICORNIO","BASILISCO","QUIMERA","HIDRA","PegasO","CENTAURO","MINOTAURO"],
  frutas: ["MANZANA","PLATANO","NARANJA","UVAS","FRESAS","PERA","MELON","SANDIA","CEREZA","PINEAPPLE"],
  marcas: ["ZARA","MANGOS","INDITEX","TELEFONICA","BBVA","SANTANDER","REPSOL","IBERDROLA","ENDESA","MOVISTAR"]
};

// Salas activas
const salas = {};

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('configurar-partida', (data) => {
    const codigo = generarCodigo();
    
    salas[codigo] = {
      host: socket.id,
      hostNombre: data.nombreHost,
      jugadores: [{ id: socket.id, nombre: data.nombreHost, esHost: true }],
      modo: data.modo,
      categoria: data.categoria,
      palabraManual: data.palabraManual,
      numImpostores: data.numImpostores,
      enRonda: false,
      palabraActual: null
    };

    socket.join(codigo);
    socket.emit('partida-configurada', { 
      codigo, 
      modo: data.modo, 
      categoria: data.categoria 
    });
    
    // ✅ ENVÍA JUGADORES INICIALES AL HOST
    socket.emit('jugadores-actualizados', salas[codigo].jugadores);
    
    console.log(`Sala ${codigo} creada por ${data.nombreHost}`);
  });

  socket.on('unirse-partida', (data) => {
    const sala = salas[data.codigo];
    if (!sala) {
      socket.emit('error-unirse', 'Sala no existe');
      return;
    }
    if (sala.jugadores.length >= 10) {
      socket.emit('error-unirse', 'Sala llena');
      return;
    }
    
    // Prevenir duplicados
    if (sala.jugadores.find(j => j.nombre.toLowerCase() === data.nombre.toLowerCase())) {
      socket.emit('error-unirse', 'Ya hay un jugador con ese nombre');
      return;
    }

    socket.join(data.codigo);
    sala.jugadores.push({ id: socket.id, nombre: data.nombre, esHost: false });
    
    socket.emit('partida-configurada', { 
      codigo: data.codigo, 
      modo: sala.modo, 
      categoria: sala.categoria 
    });
    
    // ✅ ENVÍA JUGADORES A TODOS
    io.to(data.codigo).emit('jugadores-actualizados', sala.jugadores);
    console.log(`${data.nombre} se unió a ${data.codigo}`);
  });

  socket.on('iniciar-ronda', (codigo) => {
    const sala = salas[codigo];
    if (!sala || socket.id !== sala.host || sala.jugadores.length < 3 || sala.enRonda) {
      socket.emit('error-ronda', 'No puedes iniciar la ronda');
      return;
    }

    sala.enRonda = true;
    const palabra = obtenerPalabra(sala);
    sala.palabraActual = palabra;

    const numImpostores = sala.numImpostores;
    const indicesImpostores = [];
    while (indicesImpostores.length < numImpostores) {
      const idx = Math.floor(Math.random() * sala.jugadores.length);
      if (!indicesImpostores.includes(idx) && 
          (sala.modo !== 'manual' || idx !== 0)) { // Host no impostor en manual
        indicesImpostores.push(idx);
      }
    }

    sala.jugadores.forEach((jugador, i) => {
      const esImpostor = indicesImpostores.includes(i);
      io.to(jugador.id).emit('tu-rol', {
        palabra: esImpostor ? '???' : palabra,
        impostor: esImpostor,
        modo: sala.modo,
        categoria: sala.categoria
      });
    });
  });

  socket.on('solicitar-nueva-partida', (codigo) => {
    const sala = salas[codigo];
    if (!sala || socket.id !== sala.host) return;
    
    io.to(codigo).emit('nueva-partida-pedida', { codigo, segundos: 10 });
  });

  socket.on('respuesta-nueva-partida', (data) => {
    const sala = salas[data.codigo];
    if (!sala) return;
    
    if (data.acepta) {
      sala.enRonda = false;
      io.to(data.codigo).emit('listo-para-nueva-ronda', { codigo: data.codigo });
    }
  });

  socket.on('disconnect', () => {
    for (const codigo in salas) {
      const sala = salas[codigo];
      const idx = sala.jugadores.findIndex(j => j.id === socket.id);
      if (idx !== -1) {
        sala.jugadores.splice(idx, 1);
        io.to(codigo).emit('jugadores-actualizados', sala.jugadores);
        
        if (socket.id === sala.host) {
          delete salas[codigo];
          console.log(`Sala ${codigo} eliminada (host desconectado)`);
        }
        break;
      }
    }
  });
});

function generarCodigo() {
  return Math.random().toString(36).substr(2, 4).toUpperCase();
}

function obtenerPalabra(sala) {
  if (sala.modo === 'manual') return sala.palabraManual;
  if (sala.modo === 'random') {
    const todas = Object.values(palabras).flat();
    return todas[Math.floor(Math.random() * todas.length)];
  }
  if (sala.modo === 'randomCategoria' && sala.categoria) {
    const cat = palabras[sala.categoria];
    return cat[Math.floor(Math.random() * cat.length)];
  }
  return "ERROR";
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server corriendo en puerto ${PORT}`);
});
;

