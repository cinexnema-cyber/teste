import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/database";
import { handleDemo } from "./routes/demo";
import { login, register, validateToken } from "./routes/auth";
import { authenticateToken, requireSubscriber } from "./middleware/auth";
import {
  getSubscriptionPlans,
  createSubscription,
  cancelSubscription,
  getSubscriptionStatus,
  handleMercadoPagoWebhook,
} from "./routes/subscription";
import {
  uploadContent,
  getCreatorContent,
  updateContentStatus,
  getPendingContent,
  recordView,
} from "./routes/content";
import { initializeAdmin, initializeSampleData } from "./scripts/initAdmin";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Initialize database connection
  const initializeDatabase = async () => {
    try {
      await connectDB();

      // Initialize admin user and sample data after successful connection
      await initializeAdmin();
      await initializeSampleData();
    } catch (error) {
      console.error("❌ Erro na inicialização do banco de dados:", error);
      console.log("🚨 Continuando sem banco de dados...");
    }
  };

  // Connect to database
  initializeDatabase();

  // Health check
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });



  // Demo route
  app.get("/api/demo", handleDemo);

  // Create test user route
  app.post("/api/admin/create-test-user", async (_req, res) => {
    try {
      const User = require("./models/User").default;

      // Delete existing test user if exists (both admin and subscriber)
      await User.deleteMany({ email: "cinexnema@gmail.com" });

      // Create new test subscriber user
      const testUser = new User({
        email: "cinexnema@gmail.com",
        password: "I30C77T$Ii", // Will be hashed automatically
        name: "CineXnema Test User",
        role: "subscriber",
        assinante: true, // Full access without payment
        subscription: {
          plan: "premium",
          status: "active",
          startDate: new Date(),
          nextBilling: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          paymentMethod: "test_account",
        },
        watchHistory: [],
      });

      const savedUser = await testUser.save();

      console.log("✅ Usuário de teste criado via API:");
      console.log("📧 Email: cinexnema@gmail.com");
      console.log("🔑 Senha: I30C77T$Ii");

      res.json({
        success: true,
        message: "Usuário de teste criado com sucesso",
        user: {
          email: savedUser.email,
          name: savedUser.name,
          role: savedUser.role,
          assinante: savedUser.assinante,
          subscription: savedUser.subscription
        },
        loginInfo: {
          email: "cinexnema@gmail.com",
          password: "I30C77T$Ii",
          access: "Acesso completo sem pagamento"
        }
      });

    } catch (error) {
      console.error("❌ Erro ao criar usuário de teste:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Authentication routes
  app.post("/api/auth/login", login);
  app.post("/api/auth/register", register);
  app.get("/api/auth/validate", authenticateToken, validateToken);

  // Subscription routes
  app.get("/api/subscription/plans", getSubscriptionPlans);
  app.post(
    "/api/subscription/subscribe",
    authenticateToken,
    requireSubscriber,
    createSubscription,
  );
  app.post(
    "/api/subscription/cancel",
    authenticateToken,
    requireSubscriber,
    cancelSubscription,
  );
  app.get("/api/subscription/status", authenticateToken, getSubscriptionStatus);
  app.post("/api/webhook/mercadopago", handleMercadoPagoWebhook);

  // Auto-register subscriber on payment confirmation
  app.post("/api/subscription/auto-register", async (req, res) => {
    try {
      const { email, paymentId, plan = "premium" } = req.body;

      if (!email || !paymentId) {
        return res.status(400).json({
          success: false,
          message: "Email e ID de pagamento são obrigatórios"
        });
      }

      const User = require("./models/User").default;

      // Check if user already exists
      let user = await User.findOne({ email: email.toLowerCase() });

      if (user) {
        // Update existing user with subscription
        user.role = "subscriber";
        user.assinante = true;
        user.subscription = {
          plan: plan,
          status: "active",
          startDate: new Date(),
          nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          paymentMethod: "mercado_pago",
          mercadoPagoId: paymentId
        };
        user.watchHistory = user.watchHistory || [];

        await user.save();

        console.log("✅ Usuário existente atualizado com assinatura:", email);
      } else {
        // Create new subscriber user
        const userData = {
          email: email.toLowerCase(),
          password: `temp_${Date.now()}_${Math.random().toString(36)}`, // Temporary password
          name: email.split('@')[0] || 'Usuário XNEMA',
          role: "subscriber",
          assinante: true,
          subscription: {
            plan: plan,
            status: "active",
            startDate: new Date(),
            nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            paymentMethod: "mercado_pago",
            mercadoPagoId: paymentId
          },
          watchHistory: []
        };

        user = new User(userData);
        await user.save();

        console.log("✅ Novo usuário assinante criado automaticamente:", email);
      }

      res.json({
        success: true,
        message: "Usuário registrado/atualizado com sucesso",
        user: user.toJSON()
      });

    } catch (error) {
      console.error("��� Erro no registro automático:", error);
      res.status(500).json({
        success: false,
        message: "Erro interno do servidor"
      });
    }
  });

  // Content management routes
  app.post("/api/content/upload", authenticateToken, uploadContent);
  app.get("/api/content/creator", authenticateToken, getCreatorContent);
  app.put(
    "/api/content/:contentId/status",
    authenticateToken,
    updateContentStatus,
  );
  app.get("/api/content/pending", authenticateToken, getPendingContent);
  app.post("/api/content/:contentId/view", recordView);

  // Protected routes (examples)
  app.get("/api/admin/users", authenticateToken, async (req, res) => {
    try {
      // Only admins can access this
      if (req.userRole !== "admin") {
        return res.status(403).json({ message: "Acesso negado" });
      }

      const User = require("./models/User").default;
      const users = await User.find({}).select("-password").sort({ createdAt: -1 });

      // Statistics
      const stats = {
        total: users.length,
        subscribers: users.filter(u => u.role === "subscriber").length,
        creators: users.filter(u => u.role === "creator").length,
        admins: users.filter(u => u.role === "admin").length,
        activeSubscribers: users.filter(u => u.role === "subscriber" && (u.subscription?.status === "active" || u.assinante === true)).length,
        pendingCreators: users.filter(u => u.role === "creator" && u.profile?.status === "pending").length,
        approvedCreators: users.filter(u => u.role === "creator" && u.profile?.status === "approved").length,
      };

      console.log("📊 Usuários cadastrados:", stats);

      res.json({
        success: true,
        users,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ Erro ao buscar usuários:", error);
      res.status(500).json({ message: "Erro ao buscar usuários" });
    }
  });

  // Debug route to show database status
  app.get("/api/debug/db-status", async (req, res) => {
    try {
      const User = require("./models/User").default;
      const userCount = await User.countDocuments();
      const recentUsers = await User.find({})
        .select("email role createdAt")
        .sort({ createdAt: -1 })
        .limit(5);

      res.json({
        success: true,
        database: {
          connected: true,
          host: require('mongoose').connection.host,
          name: require('mongoose').connection.name,
          totalUsers: userCount,
          recentUsers
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ Erro no debug:", error);
      const { getMongoDBConnectionInfo } = require("./utils/mongodbCheck");
      res.json({
        success: false,
        database: {
          connected: false,
          error: error.message,
          connectionInfo: getMongoDBConnectionInfo()
        },
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get("/api/creator/analytics", authenticateToken, async (req, res) => {
    try {
      if (req.userRole !== "creator") {
        return res.status(403).json({ message: "Acesso negado" });
      }

      // Mock analytics data
      const analytics = {
        totalViews: req.user.content?.totalViews || 0,
        totalEarnings: req.user.content?.totalEarnings || 0,
        monthlyViews: 450,
        monthlyEarnings: req.user.content?.monthlyEarnings || 0,
        topVideos: [
          { id: "1", title: "Vídeo Popular 1", views: 500, earnings: 25.5 },
          { id: "2", title: "Vídeo Popular 2", views: 300, earnings: 15.75 },
        ],
        viewsHistory: [
          { date: "2024-01-01", views: 100 },
          { date: "2024-01-02", views: 150 },
          { date: "2024-01-03", views: 200 },
        ],
      };

      res.json(analytics);
    } catch (error) {
      res.status(500).json({ message: "Erro ao buscar analytics" });
    }
  });

  return app;
}
