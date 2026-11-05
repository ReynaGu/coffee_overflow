const pool = require('../config/db');

const getProducts = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM test_products'
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error('Error retrieving products:', error);

    res.status(500).json({
      error: 'Failed to retrieve products'
    });
  }
};

const getProductById = async (req, res) => {
    try {
      const { id } = req.params;
  
      const [rows] = await pool.execute(
        'SELECT * FROM test_products WHERE product_id = ?',
        [id]
      );
  
      if (rows.length === 0) {
        return res.status(404).json({
          error: 'Product not found'
        });
      }
  
      res.status(200).json(rows[0]);
    } catch (error) {
      console.error('Error retrieving product:', error);
  
      res.status(500).json({
        error: 'Failed to retrieve product'
      });
    }
  };

  module.exports = { getProducts, getProductById };
