import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";

const app = express();
app.use(cors());

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.get("/api/health", (req, res) => {
  res.json({ message: "BloodConnect API is running" });
});

app.post("/api/donors", async (req, res) => {
  const { name, bloodGroup, phone, location } = req.body;

  const donor = await prisma.donor.create({
    data: {
      name,
      bloodGroup,
      phone,
      location,
    },
  });
  res.json(donor);
});

app.get("/api/donors", async (req, res) => {
  const donors = await prisma.donor.findMany();
  res.json(donors);
});

app.put("/api/donors/:id", async (req, res) => {
  const id = Number(req.params.id);

  const donor = await prisma.donor.update({
    where: { id },
    data: req.body,
  });
  res.json(donor);
});

app.delete("/api/donors/:id", async (req, res) => {
  const id = Number(req.params.id);

  const donor = await prisma.donor.delete({
    where: { id },
  });
  res.json({message: "donor deleted successfully"});
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
